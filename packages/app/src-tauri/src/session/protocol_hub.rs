//! Per-pane protocol sessions, history ring buffer, and throttled `agent://event` emit.

use crate::protocol::{
    AgentEvent, AgentEventEnvelope, Capabilities, Endpoint, ProtocolAdapter, ProtocolSession,
    HISTORY_CAP, AGENT_EVENT_CHANNEL,
};
use crate::session::SessionStateStore;
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const COALESCE_MS: u64 = 32;

struct PaneProtocol {
    capabilities: Capabilities,
    history: VecDeque<AgentEventEnvelope>,
    seq: u64,
    session: Arc<dyn ProtocolSession>,
    protocol_child_pid: Option<u32>,
    _pump: thread::JoinHandle<()>,
}

pub struct ProtocolHub {
    inner: Mutex<HubInner>,
}

struct HubInner {
    panes: HashMap<String, PaneProtocol>,
    session_states: Option<Arc<SessionStateStore>>,
    app: Option<AppHandle>,
    coalesce: HashMap<String, HashMap<String, AgentEvent>>,
    flush_scheduled: HashMap<String, bool>,
}

impl ProtocolHub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(HubInner {
                panes: HashMap::new(),
                session_states: None,
                app: None,
                coalesce: HashMap::new(),
                flush_scheduled: HashMap::new(),
            }),
        })
    }

    pub fn bind_app(self: &Arc<Self>, app: AppHandle, session_states: Arc<SessionStateStore>) {
        let mut inner = self.inner.lock();
        inner.app = Some(app);
        inner.session_states = Some(session_states);
    }

    pub fn unregister(self: &Arc<Self>, pane_id: &str) {
        let mut inner = self.inner.lock();
        inner.panes.remove(pane_id);
        inner.coalesce.remove(pane_id);
        inner.flush_scheduled.remove(pane_id);
        if let Some(store) = inner.session_states.as_ref() {
            store.set_protocol_backed(pane_id, false);
        }
    }

    pub fn has_session(self: &Arc<Self>, pane_id: &str) -> bool {
        self.inner.lock().panes.contains_key(pane_id)
    }

    pub fn register(
        self: &Arc<Self>,
        pane_id: String,
        adapter: Arc<dyn ProtocolAdapter>,
        endpoint: Endpoint,
    ) -> Result<(), String> {
        let session = adapter
            .connect(endpoint)
            .map_err(|e| e.to_string())?;
        let capabilities = session.capabilities();
        let protocol_child_pid = session.child_pid();
        let session: Arc<dyn ProtocolSession> = Arc::from(session);
        let mut rx = session.subscribe();
        let hub = Arc::clone(self);
        let pane_for_pump = pane_id.clone();
        let pump = thread::Builder::new()
            .name(format!("protocol-{pane_id}"))
            .spawn(move || {
                while let Ok(event) = rx.blocking_recv() {
                    hub.ingest(&pane_for_pump, event);
                }
            })
            .map_err(|e| format!("spawn protocol pump: {e}"))?;

        self.inner.lock().panes.insert(
            pane_id.clone(),
            PaneProtocol {
                capabilities,
                history: VecDeque::new(),
                seq: 0,
                session,
                protocol_child_pid,
                _pump: pump,
            },
        );
        if let Some(store) = self.inner.lock().session_states.as_ref() {
            store.set_protocol_backed(&pane_id, true);
        }
        Ok(())
    }

    pub fn capabilities(self: &Arc<Self>, pane_id: &str) -> Capabilities {
        self.inner
            .lock()
            .panes
            .get(pane_id)
            .map(|p| p.capabilities.clone())
            .unwrap_or_else(Capabilities::none)
    }

    pub fn history(self: &Arc<Self>, pane_id: &str) -> Vec<AgentEventEnvelope> {
        self.inner
            .lock()
            .panes
            .get(pane_id)
            .map(|p| p.history.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn send_prompt(self: &Arc<Self>, pane_id: &str, text: String) -> Result<(), String> {
        let session = self
            .inner
            .lock()
            .panes
            .get(pane_id)
            .map(|p| Arc::clone(&p.session))
            .ok_or_else(|| format!("no protocol session for pane {pane_id}"))?;
        session.send_prompt(text).map_err(|e| e.to_string())
    }

    pub fn respond_approval(
        self: &Arc<Self>,
        pane_id: &str,
        approval_id: &str,
        decision: &str,
    ) -> Result<(), String> {
        let session = self
            .inner
            .lock()
            .panes
            .get(pane_id)
            .map(|p| Arc::clone(&p.session))
            .ok_or_else(|| format!("no protocol session for pane {pane_id}"))?;
        session
            .respond_to_approval(approval_id, decision)
            .map_err(|e| e.to_string())
    }

    pub fn protocol_child_pid(self: &Arc<Self>, pane_id: &str) -> Option<u32> {
        self.inner
            .lock()
            .panes
            .get(pane_id)
            .and_then(|p| p.protocol_child_pid)
    }

    pub fn cancel_turn(self: &Arc<Self>, pane_id: &str) -> Result<(), String> {
        let session = self
            .inner
            .lock()
            .panes
            .get(pane_id)
            .map(|p| Arc::clone(&p.session))
            .ok_or_else(|| format!("no protocol session for pane {pane_id}"))?;
        session.cancel_turn().map_err(|e| e.to_string())
    }

    fn should_flush_before(event: &AgentEvent) -> bool {
        matches!(
            event,
            AgentEvent::TurnCompleted { .. }
                | AgentEvent::MessageCompleted { .. }
                | AgentEvent::ApprovalRequested { .. }
                | AgentEvent::ApprovalResolved { .. }
        )
    }

    fn ingest(self: &Arc<Self>, pane_id: &str, event: AgentEvent) {
        if let Some(store) = self.inner.lock().session_states.as_ref() {
            if let Some(snap) = store.apply_agent_event(pane_id, &event) {
                crate::session::state::push_agent_state(store.as_ref(), snap);
            }
        }

        if Self::should_flush_before(&event) {
            self.flush_coalesced(pane_id);
        }

        if let AgentEvent::MessageDelta { message_id, .. } = &event {
            let mut inner = self.inner.lock();
            inner
                .coalesce
                .entry(pane_id.to_string())
                .or_default()
                .insert(message_id.clone(), event);
            drop(inner);
            self.schedule_flush(pane_id);
            return;
        }

        self.commit_event(pane_id, event);
    }

    fn schedule_flush(self: &Arc<Self>, pane_id: &str) {
        let already = self
            .inner
            .lock()
            .flush_scheduled
            .insert(pane_id.to_string(), true)
            .unwrap_or(false);
        if already {
            return;
        }
        let hub = Arc::clone(self);
        let pane_id = pane_id.to_string();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(COALESCE_MS));
            hub.flush_coalesced(&pane_id);
        });
    }

    fn flush_coalesced(self: &Arc<Self>, pane_id: &str) {
        self.inner
            .lock()
            .flush_scheduled
            .insert(pane_id.to_string(), false);
        let deltas: Vec<AgentEvent> = self
            .inner
            .lock()
            .coalesce
            .remove(pane_id)
            .map(|m| m.into_values().collect())
            .unwrap_or_default();
        for event in deltas {
            self.commit_event(pane_id, event);
        }
    }

    fn commit_event(self: &Arc<Self>, pane_id: &str, event: AgentEvent) {
        let envelope = {
            let mut inner = self.inner.lock();
            let Some(pane) = inner.panes.get_mut(pane_id) else {
                return;
            };
            pane.seq += 1;
            let envelope = AgentEventEnvelope {
                pane_id: pane_id.to_string(),
                seq: pane.seq,
                event,
            };
            pane.history.push_back(envelope.clone());
            while pane.history.len() > HISTORY_CAP {
                pane.history.pop_front();
            }
            envelope
        };

        if let Some(app) = self.inner.lock().app.as_ref() {
            let _ = app.emit(AGENT_EVENT_CHANNEL, &envelope);
        }
    }
}

#[cfg(all(test, not(target_os = "windows")))]
mod tests {
    use super::*;
    use crate::agents::ProtocolKind;
    use crate::protocol::AgentError;

    struct FakeSession {
        tx: tokio::sync::broadcast::Sender<AgentEvent>,
    }

    impl ProtocolSession for FakeSession {
        fn capabilities(&self) -> Capabilities {
            Capabilities {
                chat: true,
                send_prompt: true,
                approvals: false,
                cancel: false,
                file_changes: false,
                attach_tui: true,
            }
        }

        fn subscribe(&self) -> tokio::sync::broadcast::Receiver<AgentEvent> {
            self.tx.subscribe()
        }

        fn send_prompt(&self, _text: String) -> Result<(), AgentError> {
            Ok(())
        }

        fn respond_to_approval(&self, _: &str, _: &str) -> Result<(), AgentError> {
            Err(AgentError::Unsupported("n/a".into()))
        }

        fn cancel_turn(&self) -> Result<(), AgentError> {
            Err(AgentError::Unsupported("n/a".into()))
        }
    }

    struct FakeAdapter {
        tx: tokio::sync::broadcast::Sender<AgentEvent>,
    }

    impl ProtocolAdapter for FakeAdapter {
        fn protocol(&self) -> ProtocolKind {
            ProtocolKind::OpencodeHttp
        }

        fn connect(&self, _: Endpoint) -> Result<Box<dyn ProtocolSession>, AgentError> {
            Ok(Box::new(FakeSession {
                tx: self.tx.clone(),
            }))
        }
    }

    #[test]
    fn seq_increments_and_ring_buffer_caps() {
        let hub = ProtocolHub::new();
        let (tx, _rx) = tokio::sync::broadcast::channel(8);
        let adapter = Arc::new(FakeAdapter { tx: tx.clone() });
        hub.register(
            "p-seq".into(),
            adapter,
            Endpoint {
                url: "http://127.0.0.1:1".into(),
                session_id: Some("s".into()),
                cwd: None,
                codex: None,
                connect_pane_id: None,
            },
        )
        .expect("register");

        for i in 0..(HISTORY_CAP + 5) {
            tx.send(AgentEvent::TurnStarted {
                turn_id: format!("t{i}"),
            })
            .ok();
            thread::sleep(Duration::from_millis(2));
        }
        thread::sleep(Duration::from_millis(50));
        let history = hub.history("p-seq");
        assert_eq!(history.len(), HISTORY_CAP);
        assert_eq!(history.last().map(|e| e.seq), Some((HISTORY_CAP + 5) as u64));
    }

    #[test]
    fn message_deltas_coalesce_per_message_id() {
        let hub = ProtocolHub::new();
        let (tx, _rx) = tokio::sync::broadcast::channel(16);
        let adapter = Arc::new(FakeAdapter { tx: tx.clone() });
        hub.register(
            "p-coalesce".into(),
            adapter,
            Endpoint {
                url: "http://127.0.0.1:1".into(),
                session_id: None,
                cwd: None,
                codex: None,
                connect_pane_id: None,
            },
        )
        .expect("register");

        for text in ["a", "ab", "abc"] {
            tx.send(AgentEvent::MessageDelta {
                turn_id: "t1".into(),
                message_id: "m1".into(),
                role: crate::protocol::MessageRole::Assistant,
                text: text.to_string(),
                content_kind: crate::protocol::MessageContentKind::Text,
                text_mode: crate::protocol::MessageTextMode::Append,
            })
            .ok();
            thread::sleep(Duration::from_millis(5));
        }
        thread::sleep(Duration::from_millis(80));
        let history = hub.history("p-coalesce");
        let deltas: Vec<_> = history
            .iter()
            .filter(|e| matches!(e.event, AgentEvent::MessageDelta { .. }))
            .collect();
        assert_eq!(deltas.len(), 1);
        if let AgentEvent::MessageDelta { text, .. } = &deltas[0].event {
            assert_eq!(text, "abc");
        }
    }

    #[test]
    fn history_records_events() {
        let hub = ProtocolHub::new();
        let (tx, _rx) = tokio::sync::broadcast::channel(8);
        let adapter = Arc::new(FakeAdapter { tx: tx.clone() });
        hub.register(
            "p1".into(),
            adapter,
            Endpoint {
                url: "http://127.0.0.1:1".into(),
                session_id: Some("s".into()),
                cwd: None,
                codex: None,
                connect_pane_id: None,
            },
        )
        .expect("register");

        tx.send(AgentEvent::TurnStarted {
            turn_id: "t1".into(),
        })
        .ok();
        thread::sleep(Duration::from_millis(50));
        assert_eq!(hub.history("p1").len(), 1);
    }
}
