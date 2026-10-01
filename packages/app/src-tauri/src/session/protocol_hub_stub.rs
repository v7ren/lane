//! Test-build `ProtocolHub` without Tauri emit (Windows lib tests).

use crate::protocol::{
    AgentEvent, AgentEventEnvelope, Capabilities, Endpoint, ProtocolAdapter, ProtocolSession,
    HISTORY_CAP,
};
use parking_lot::Mutex;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const COALESCE_MS: u64 = 32;

struct StubPane {
    capabilities: Capabilities,
    seed: Vec<AgentEventEnvelope>,
    history: VecDeque<AgentEventEnvelope>,
    seq: u64,
    generation: u64,
    session: Arc<dyn ProtocolSession>,
    protocol_child_pid: Option<u32>,
    _pump: thread::JoinHandle<()>,
}

static NEXT_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub struct ProtocolHub {
    panes: Mutex<HashMap<String, StubPane>>,
    coalesce: Mutex<HashMap<String, HashMap<String, AgentEvent>>>,
    tool_coalesce: Mutex<HashMap<String, HashMap<String, AgentEvent>>>,
    flush_scheduled: Mutex<HashMap<String, bool>>,
}

impl ProtocolHub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            panes: Mutex::new(HashMap::new()),
            coalesce: Mutex::new(HashMap::new()),
            tool_coalesce: Mutex::new(HashMap::new()),
            flush_scheduled: Mutex::new(HashMap::new()),
        })
    }

    pub fn bind_app(
        self: &Arc<Self>,
        _app: tauri::AppHandle,
        _session_states: Arc<crate::session::SessionStateStore>,
    ) {
    }

    pub fn unregister(self: &Arc<Self>, pane_id: &str) {
        self.panes.lock().remove(pane_id);
        self.coalesce.lock().remove(pane_id);
        self.tool_coalesce.lock().remove(pane_id);
        self.flush_scheduled.lock().remove(pane_id);
    }

    pub fn has_session(self: &Arc<Self>, pane_id: &str) -> bool {
        self.panes.lock().contains_key(pane_id)
    }

    pub fn register(
        self: &Arc<Self>,
        pane_id: String,
        adapter: Arc<dyn ProtocolAdapter>,
        endpoint: Endpoint,
    ) -> Result<(), String> {
        let session = adapter.connect(endpoint).map_err(|e| e.to_string())?;
        let capabilities = session.capabilities();
        let protocol_child_pid = session.child_pid();
        let session: Arc<dyn ProtocolSession> = Arc::from(session);
        let mut rx = session.subscribe();
        let hub = Arc::clone(self);
        let pane_for_pump = pane_id.clone();
        let pump = thread::Builder::new()
            .name(format!("protocol-stub-{pane_id}"))
            .spawn(move || {
                while let Ok(event) = rx.blocking_recv() {
                    hub.ingest(&pane_for_pump, event);
                }
            })
            .map_err(|e| format!("spawn protocol pump: {e}"))?;

        self.panes.lock().insert(
            pane_id,
            StubPane {
                capabilities,
                seed: Vec::new(),
                history: VecDeque::new(),
                seq: 0,
                generation: NEXT_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
                session,
                protocol_child_pid,
                _pump: pump,
            },
        );
        Ok(())
    }

    pub fn capabilities(self: &Arc<Self>, pane_id: &str) -> Capabilities {
        self.panes
            .lock()
            .get(pane_id)
            .map(|p| p.capabilities.clone())
            .unwrap_or_else(Capabilities::none)
    }

    pub fn history(self: &Arc<Self>, pane_id: &str) -> Vec<AgentEventEnvelope> {
        self.panes
            .lock()
            .get(pane_id)
            .map(|p| p.seed.iter().chain(p.history.iter()).cloned().collect())
            .unwrap_or_default()
    }

    pub fn protocol_child_pid(self: &Arc<Self>, pane_id: &str) -> Option<u32> {
        self.panes
            .lock()
            .get(pane_id)
            .and_then(|p| p.protocol_child_pid)
    }

    /// Put past events (a resumed chat's transcript) in front of the live stream. They go to
    /// history and the UI like any event but never touch the pane's working/idle state.
    pub fn seed_history(self: &Arc<Self>, pane_id: &str, events: Vec<AgentEvent>) {
        for event in events {
            self.commit(pane_id, event, true);
        }
    }

    /// Commit an event the hub itself creates (for example a Notice from a command handler).
    pub fn emit_local(self: &Arc<Self>, pane_id: &str, event: AgentEvent) {
        self.ingest(pane_id, event);
    }

    pub fn send_prompt(self: &Arc<Self>, pane_id: &str, text: String) -> Result<(), String> {
        let session = self
            .panes
            .lock()
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
            .panes
            .lock()
            .get(pane_id)
            .map(|p| Arc::clone(&p.session))
            .ok_or_else(|| format!("no protocol session for pane {pane_id}"))?;
        session
            .respond_to_approval(approval_id, decision)
            .map_err(|e| e.to_string())
    }

    pub fn agent_info(self: &Arc<Self>, pane_id: &str) -> Option<serde_json::Value> {
        let session = self
            .panes
            .lock()
            .get(pane_id)
            .map(|p| Arc::clone(&p.session))?;
        session.agent_info()
    }

    pub fn set_option(self: &Arc<Self>, pane_id: &str, key: &str, value: &str) -> Result<(), String> {
        let session = self
            .panes
            .lock()
            .get(pane_id)
            .map(|p| Arc::clone(&p.session))
            .ok_or_else(|| format!("no protocol session for pane {pane_id}"))?;
        session.set_option(key, value).map_err(|e| e.to_string())
    }

    pub fn cancel_turn(self: &Arc<Self>, pane_id: &str) -> Result<(), String> {
        let session = self
            .panes
            .lock()
            .get(pane_id)
            .map(|p| Arc::clone(&p.session))
            .ok_or_else(|| format!("no protocol session for pane {pane_id}"))?;
        session.cancel_turn().map_err(|e| e.to_string())
    }

    fn should_flush_before(event: &AgentEvent) -> bool {
        matches!(
            event,
            AgentEvent::TurnCompleted { .. }
                | AgentEvent::ToolCompleted { .. }
                | AgentEvent::MessageCompleted { .. }
                | AgentEvent::ApprovalRequested { .. }
                | AgentEvent::ApprovalResolved { .. }
        )
    }

    fn ingest(self: &Arc<Self>, pane_id: &str, event: AgentEvent) {
        if Self::should_flush_before(&event) {
            self.flush_coalesced(pane_id);
        }

        if let AgentEvent::MessageDelta { message_id, .. } = &event {
            let message_id = message_id.clone();
            let mut slot = self.coalesce.lock();
            let slot = slot.entry(pane_id.to_string()).or_default();
            let merged = match slot.remove(&message_id) {
                Some(prev) => Self::merge_delta(prev, event),
                None => event,
            };
            slot.insert(message_id, merged);
            self.schedule_flush(pane_id);
            return;
        }

        if let AgentEvent::ToolOutputDelta { tool_id, .. } = &event {
            let tool_id = tool_id.clone();
            let mut slot = self.tool_coalesce.lock();
            let slot = slot.entry(pane_id.to_string()).or_default();
            let merged = match slot.remove(&tool_id) {
                Some(prev) => Self::merge_tool_output(prev, event),
                None => event,
            };
            slot.insert(tool_id, merged);
            self.schedule_flush(pane_id);
            return;
        }

        self.commit_event(pane_id, event);
    }

    /// Combine two pending tool output chunks for the same tool: always append.
    fn merge_tool_output(prev: AgentEvent, next: AgentEvent) -> AgentEvent {
        match (prev, next) {
            (
                AgentEvent::ToolOutputDelta { chunk: prev_chunk, .. },
                AgentEvent::ToolOutputDelta { turn_id, tool_id, chunk },
            ) => AgentEvent::ToolOutputDelta {
                turn_id,
                tool_id,
                chunk: format!("{prev_chunk}{chunk}"),
            },
            (_, next) => next,
        }
    }

    /// Combine two pending deltas for the same message: `Replace` supersedes everything
    /// before it, `Append` adds its text onto the pending one (never drops chunks).
    fn merge_delta(prev: AgentEvent, next: AgentEvent) -> AgentEvent {
        use crate::protocol::MessageTextMode;
        match (prev, next) {
            (
                AgentEvent::MessageDelta { text: prev_text, text_mode: prev_mode, .. },
                AgentEvent::MessageDelta {
                    turn_id,
                    message_id,
                    role,
                    text,
                    content_kind,
                    text_mode,
                },
            ) => match text_mode {
                MessageTextMode::Replace => AgentEvent::MessageDelta {
                    turn_id,
                    message_id,
                    role,
                    text,
                    content_kind,
                    text_mode,
                },
                MessageTextMode::Append => AgentEvent::MessageDelta {
                    turn_id,
                    message_id,
                    role,
                    text: format!("{prev_text}{text}"),
                    content_kind,
                    // A pending Replace base stays a Replace so the consumer resets first.
                    text_mode: prev_mode,
                },
            },
            (_, next) => next,
        }
    }

    fn schedule_flush(self: &Arc<Self>, pane_id: &str) {
        let already = self
            .flush_scheduled
            .lock()
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
        self.flush_scheduled
            .lock()
            .insert(pane_id.to_string(), false);
        let mut deltas: Vec<AgentEvent> = self
            .coalesce
            .lock()
            .remove(pane_id)
            .map(|m| m.into_values().collect())
            .unwrap_or_default();
        deltas.extend(
            self.tool_coalesce
                .lock()
                .remove(pane_id)
                .map(|m| m.into_values().collect::<Vec<_>>())
                .unwrap_or_default(),
        );
        for event in deltas {
            self.commit_event(pane_id, event);
        }
    }

    fn commit_event(self: &Arc<Self>, pane_id: &str, event: AgentEvent) {
        self.commit(pane_id, event, false);
    }

    fn commit(self: &Arc<Self>, pane_id: &str, event: AgentEvent, replayed: bool) {
        let ephemeral = matches!(event, AgentEvent::ToolOutputDelta { .. });
        let mut panes = self.panes.lock();
        let Some(pane) = panes.get_mut(pane_id) else {
            return;
        };
        pane.seq += 1;
        let envelope = AgentEventEnvelope {
            pane_id: pane_id.to_string(),
            seq: pane.seq,
            event,
            epoch: pane.generation,
            replayed,
            ts_ms: crate::events::now_ms(),
        };
        if replayed {
            pane.seed.push(envelope);
        } else if !ephemeral {
            pane.history.push_back(envelope);
            while pane.history.len() > HISTORY_CAP {
                pane.history.pop_front();
            }
        }
    }

    pub fn ingest_test_event(self: &Arc<Self>, pane_id: &str, event: AgentEvent) {
        self.ingest(pane_id, event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::ProtocolKind;
    use crate::protocol::{AgentError, MessageContentKind, MessageRole, MessageTextMode};

    struct FakeSession {
        tx: tokio::sync::broadcast::Sender<AgentEvent>,
    }

    impl ProtocolSession for FakeSession {
        fn capabilities(&self) -> Capabilities {
            Capabilities::none()
        }
        fn subscribe(&self) -> tokio::sync::broadcast::Receiver<AgentEvent> {
            self.tx.subscribe()
        }
        fn send_prompt(&self, _: String) -> Result<(), AgentError> {
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
            Ok(Box::new(FakeSession { tx: self.tx.clone() }))
        }
    }

    fn endpoint() -> Endpoint {
        Endpoint {
            url: "http://127.0.0.1:1".into(),
            session_id: None,
            cwd: None,
            codex: None,
            connect_pane_id: None,
        }
    }

    fn register(hub: &Arc<ProtocolHub>, pane: &str) -> tokio::sync::broadcast::Sender<AgentEvent> {
        let (tx, _rx) = tokio::sync::broadcast::channel(64);
        hub.register(pane.into(), Arc::new(FakeAdapter { tx: tx.clone() }), endpoint())
            .expect("register");
        tx
    }

    fn turn(i: usize) -> AgentEvent {
        AgentEvent::TurnStarted { turn_id: format!("t{i}") }
    }

    fn delta(text: &str, mode: MessageTextMode) -> AgentEvent {
        AgentEvent::MessageDelta {
            turn_id: "t1".into(),
            message_id: "m1".into(),
            role: MessageRole::Assistant,
            text: text.into(),
            content_kind: MessageContentKind::Text,
            text_mode: mode,
        }
    }

    #[test]
    fn append_deltas_concatenate() {
        let hub = ProtocolHub::new();
        register(&hub, "p");
        for t in ["I", "'ll", " run"] {
            hub.ingest_test_event("p", delta(t, MessageTextMode::Append));
        }
        thread::sleep(Duration::from_millis(120));
        let joined: String = hub
            .history("p")
            .iter()
            .filter_map(|e| match &e.event {
                AgentEvent::MessageDelta { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(joined, "I'll run");
    }

    #[test]
    fn replace_delta_supersedes_pending() {
        let hub = ProtocolHub::new();
        register(&hub, "p");
        hub.ingest_test_event("p", delta("a", MessageTextMode::Append));
        hub.ingest_test_event("p", delta("xyz", MessageTextMode::Replace));
        thread::sleep(Duration::from_millis(120));
        let h = hub.history("p");
        assert_eq!(h.len(), 1);
        assert!(matches!(&h[0].event, AgentEvent::MessageDelta { text, .. } if text == "xyz"));
    }

    #[test]
    fn tool_output_is_coalesced_emitted_but_never_stored() {
        let hub = ProtocolHub::new();
        register(&hub, "p");
        for c in ["a", "b", "c"] {
            hub.ingest_test_event(
                "p",
                AgentEvent::ToolOutputDelta { turn_id: "t".into(), tool_id: "x".into(), chunk: c.into() },
            );
        }
        thread::sleep(Duration::from_millis(120));
        assert!(hub.history("p").is_empty());
        // It still consumed a seq (it was emitted), so the next stored event is not seq 1.
        hub.ingest_test_event("p", turn(1));
        let h = hub.history("p");
        assert_eq!(h.len(), 1);
        assert!(h[0].seq >= 2, "seq {}", h[0].seq);
    }

    #[test]
    fn seeded_events_are_replayed_uncapped_and_precede_live() {
        let hub = ProtocolHub::new();
        register(&hub, "p");
        hub.seed_history("p", (0..3).map(turn).collect());
        for i in 0..(HISTORY_CAP + 10) {
            hub.ingest_test_event("p", turn(100 + i));
        }
        let h = hub.history("p");
        assert_eq!(h.len(), 3 + HISTORY_CAP, "seed survives a full ring");
        assert!(h[..3].iter().all(|e| e.replayed));
        assert!(h[3..].iter().all(|e| !e.replayed));
        assert!(h.iter().all(|e| e.ts_ms > 0));
        assert!(matches!(&h[0].event, AgentEvent::TurnStarted { turn_id } if turn_id == "t0"));
    }

    #[test]
    fn epoch_changes_on_reregister() {
        let hub = ProtocolHub::new();
        register(&hub, "p");
        hub.ingest_test_event("p", turn(1));
        let first = hub.history("p")[0].epoch;
        hub.unregister("p");
        register(&hub, "p");
        hub.ingest_test_event("p", turn(2));
        let second = hub.history("p")[0].epoch;
        assert_ne!(first, second);
        assert!(second > first);
    }

    #[test]
    fn emit_local_commits_an_event() {
        let hub = ProtocolHub::new();
        register(&hub, "p");
        hub.emit_local(
            "p",
            AgentEvent::Notice {
                id: "n".into(),
                level: crate::protocol::NoticeLevel::Info,
                text: "hi".into(),
                source: Some("loomria".into()),
                action: None,
                sticky: false,
                cleared: false,
            },
        );
        let h = hub.history("p");
        assert_eq!(h.len(), 1);
        assert!(!h[0].replayed);
        assert!(matches!(&h[0].event, AgentEvent::Notice { id, .. } if id == "n"));
    }
}
