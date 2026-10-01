//! Per-pane session state derived from the event sink.

use crate::events::{subscribe, EventEntry, SystemEvent};
use crate::protocol::AgentEvent;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use parking_lot::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionStateKind {
    Idle,
    Working,
    NeedsApproval,
    Done,
    Error,
    RateLimited,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStateSnapshot {
    pub pane_id: String,
    pub agent_type: Option<String>,
    pub state: SessionStateKind,
    pub updated_at_ms: i64,
    pub detail: Option<String>,
    /// True when the pane is driven by a protocol adapter (state comes from agent events, not
    /// terminal activity), so the raw pane status must not be used to decide working vs idle.
    #[serde(default)]
    pub protocol_backed: bool,
}

pub struct SessionStateStore {
    states: Mutex<HashMap<String, SessionStateSnapshot>>,
    agent_types: Mutex<HashMap<String, String>>,
    protocol_panes: Mutex<HashSet<String>>,
}

impl SessionStateStore {
    pub fn new() -> Self {
        Self {
            states: Mutex::new(HashMap::new()),
            agent_types: Mutex::new(HashMap::new()),
            protocol_panes: Mutex::new(HashSet::new()),
        }
    }

    pub fn set_protocol_backed(&self, pane_id: &str, backed: bool) {
        let mut set = self.protocol_panes.lock();
        if backed {
            set.insert(pane_id.to_string());
        } else {
            set.remove(pane_id);
        }
    }

    pub fn apply_agent_event(&self, pane_id: &str, event: &AgentEvent) -> Option<SessionStateSnapshot> {
        let (state, detail) = match event {
            AgentEvent::ApprovalRequested { title, .. } => {
                (SessionStateKind::NeedsApproval, Some(title.clone()))
            }
            AgentEvent::TurnStarted { .. } | AgentEvent::MessageDelta { .. } => {
                (SessionStateKind::Working, None)
            }
            AgentEvent::TurnCompleted { status, error, .. } => match status {
                crate::protocol::TurnStatus::Ok => (SessionStateKind::Done, None),
                crate::protocol::TurnStatus::Cancelled => (SessionStateKind::Idle, None),
                crate::protocol::TurnStatus::Error => (
                    SessionStateKind::Error,
                    error.clone().or_else(|| Some("turn error".into())),
                ),
            },
            AgentEvent::Error { message } => (SessionStateKind::Error, Some(message.clone())),
            AgentEvent::RateLimited { message, .. } => {
                (SessionStateKind::RateLimited, Some(message.clone()))
            }
            _ => return None,
        };
        Some(self.upsert(
            pane_id.to_string(),
            state,
            detail,
            crate::events::now_ms(),
        ))
    }

    pub fn snapshot_all(&self) -> Vec<SessionStateSnapshot> {
        self.states.lock().values().cloned().collect()
    }

    pub fn get(&self, pane_id: &str) -> Option<SessionStateSnapshot> {
        self.states.lock().get(pane_id).cloned()
    }

    pub fn apply_event(&self, entry: &EventEntry) -> Option<SessionStateSnapshot> {
        let pane_id = match &entry.payload {
            SystemEvent::PaneSpawned { pane_id, agent_type, .. } => {
                self.agent_types
                    .lock()
                    .insert(pane_id.0.clone(), agent_type.clone());
                Some((pane_id.0.clone(), SessionStateKind::Working, None))
            }
            SystemEvent::PaneKilled { pane_id } => {
                self.agent_types.lock().remove(&pane_id.0);
                self.protocol_panes.lock().remove(&pane_id.0);
                Some((pane_id.0.clone(), SessionStateKind::Idle, None))
            }
            SystemEvent::PaneStatusChanged { pane_id, status } => {
                if self.protocol_panes.lock().contains(&pane_id.0) {
                    return None;
                }
                let kind = match status.as_str() {
                    "waiting_input" => SessionStateKind::NeedsApproval,
                    "idle" => SessionStateKind::Idle,
                    "error" => SessionStateKind::Error,
                    _ => SessionStateKind::Working,
                };
                Some((pane_id.0.clone(), kind, Some(status.clone())))
            }
            SystemEvent::AgentObservation {
                pane_id,
                observation,
                text,
                ..
            } => {
                if self.protocol_panes.lock().contains(&pane_id.0) {
                    return None;
                }
                let kind = match observation.as_str() {
                    "permission_prompt" => SessionStateKind::NeedsApproval,
                    "agent_blocked" => SessionStateKind::NeedsApproval,
                    "final_report" => SessionStateKind::Done,
                    "test_failure" => SessionStateKind::Error,
                    _ if observation.contains("rate") => SessionStateKind::RateLimited,
                    _ => SessionStateKind::Working,
                };
                Some((pane_id.0.clone(), kind, text.clone()))
            }
            SystemEvent::PaneOutputObserved { pane_id, .. } => {
                if self.protocol_panes.lock().contains(&pane_id.0) {
                    return None;
                }
                Some((pane_id.0.clone(), SessionStateKind::Working, None))
            }
            _ => None,
        };

        pane_id.map(|(id, state, detail)| self.upsert(id, state, detail, entry.timestamp_ms))
    }

    pub(crate) fn upsert(
        &self,
        pane_id: String,
        state: SessionStateKind,
        detail: Option<String>,
        updated_at_ms: i64,
    ) -> SessionStateSnapshot {
        let snap = SessionStateSnapshot {
            pane_id: pane_id.clone(),
            agent_type: self.agent_types.lock().get(&pane_id).cloned(),
            state,
            updated_at_ms,
            detail,
            protocol_backed: self.protocol_panes.lock().contains(&pane_id),
        };
        self.states.lock().insert(pane_id, snap.clone());
        snap
    }
}

pub fn spawn_state_monitor(store: Arc<SessionStateStore>) {
    std::thread::Builder::new()
        .name("session-state-monitor".into())
        .spawn(move || {
            let mut rx = subscribe();
            while let Ok(entry) = rx.blocking_recv() {
                match &entry.payload {
                    SystemEvent::PaneSpawned {
                        pane_id,
                        agent_type,
                        cwd,
                        ..
                    } => {
                        let shape = if agent_type == "opencode_native" {
                            "dual"
                        } else {
                            "pty"
                        };
                        crate::session::persist::upsert_spawn(
                            agent_type,
                            cwd,
                            &pane_id.0,
                            shape,
                            None,
                        );
                    }
                    SystemEvent::PaneKilled { pane_id } => {
                        crate::session::persist::remove_pane(&pane_id.0);
                    }
                    _ => {}
                }
                if let Some(snap) = store.apply_event(&entry) {
                    crate::bridge::push_session_state_sse(&snap);
                    if snap.state == SessionStateKind::NeedsApproval
                        || snap.state == SessionStateKind::Done
                    {
                        crate::session::notify::maybe_notify(&snap);
                    }
                }
            }
        })
        .expect("spawn session state monitor");
}

pub fn push_agent_state(_store: &SessionStateStore, snap: SessionStateSnapshot) {
    crate::bridge::push_session_state_sse(&snap);
    if snap.state == SessionStateKind::NeedsApproval || snap.state == SessionStateKind::Done {
        crate::session::notify::maybe_notify(&snap);
    }
}

impl SessionStateKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Working => "working",
            Self::NeedsApproval => "needs_approval",
            Self::Done => "done",
            Self::Error => "error",
            Self::RateLimited => "rate_limited",
        }
    }
}
