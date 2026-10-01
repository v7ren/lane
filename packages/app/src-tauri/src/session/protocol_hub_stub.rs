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
    history: VecDeque<AgentEventEnvelope>,
    seq: u64,
    session: Arc<dyn ProtocolSession>,
    protocol_child_pid: Option<u32>,
    _pump: thread::JoinHandle<()>,
}

pub struct ProtocolHub {
    panes: Mutex<HashMap<String, StubPane>>,
    coalesce: Mutex<HashMap<String, HashMap<String, AgentEvent>>>,
    flush_scheduled: Mutex<HashMap<String, bool>>,
}

impl ProtocolHub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            panes: Mutex::new(HashMap::new()),
            coalesce: Mutex::new(HashMap::new()),
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
                history: VecDeque::new(),
                seq: 0,
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
            .map(|p| p.history.iter().cloned().collect())
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
            self.commit_event(pane_id, event);
        }
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
            self.coalesce
                .lock()
                .entry(pane_id.to_string())
                .or_default()
                .insert(message_id.clone(), event.clone());
            self.schedule_flush(pane_id);
            return;
        }

        self.commit_event(pane_id, event);
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
        let deltas: Vec<AgentEvent> = self
            .coalesce
            .lock()
            .remove(pane_id)
            .map(|m| m.into_values().collect())
            .unwrap_or_default();
        for event in deltas {
            self.commit_event(pane_id, event);
        }
    }

    fn commit_event(self: &Arc<Self>, pane_id: &str, event: AgentEvent) {
        let mut panes = self.panes.lock();
        let Some(pane) = panes.get_mut(pane_id) else {
            return;
        };
        pane.seq += 1;
        pane.history.push_back(AgentEventEnvelope {
            pane_id: pane_id.to_string(),
            seq: pane.seq,
            event,
        });
        while pane.history.len() > HISTORY_CAP {
            pane.history.pop_front();
        }
    }

    pub fn ingest_test_event(self: &Arc<Self>, pane_id: &str, event: AgentEvent) {
        self.ingest(pane_id, event);
    }
}
