#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::actors::ActorId;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LastEventSummary {
    pub event_type: String,
    pub timestamp_ms: i64,
}

/// Pane role in the coordination model (kept for event payloads until strip completes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaneRole {
    Implementer,
    Reviewer,
    Shell,
    Orchestrator,
    Observer,
}

impl PaneRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Implementer => "implementer",
            Self::Reviewer => "reviewer",
            Self::Shell => "shell",
            Self::Orchestrator => "orchestrator",
            Self::Observer => "observer",
        }
    }

    #[allow(dead_code)]
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "implementer" => Ok(Self::Implementer),
            "reviewer" => Ok(Self::Reviewer),
            "shell" => Ok(Self::Shell),
            "orchestrator" => Ok(Self::Orchestrator),
            "observer" => Ok(Self::Observer),
            _ => Err(format!("invalid pane role: {value}")),
        }
    }
}

const EVENT_BUS_CAPACITY: usize = 1024;

static EVENT_BUS: OnceLock<broadcast::Sender<EventEntry>> = OnceLock::new();

static LAST_PANE_EVENT: Lazy<Mutex<HashMap<String, LastEventSummary>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn event_bus() -> &'static broadcast::Sender<EventEntry> {
    EVENT_BUS.get_or_init(|| {
        let (tx, _) = broadcast::channel(EVENT_BUS_CAPACITY);
        tx
    })
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// In-process event sink for pane lifecycle and protocol hooks (replaces `event_log` for kept paths).
pub fn emit(payload: SystemEvent) {
    let entry = EventEntry::new(ActorId::system(), CommandId::new(), payload);
    if let Some(pane_id) = event_pane_id(&entry.payload) {
        LAST_PANE_EVENT.lock().insert(
            pane_id.0.clone(),
            LastEventSummary {
                event_type: event_type_name(&entry.payload).to_string(),
                timestamp_ms: entry.timestamp_ms,
            },
        );
    }
    let _ = event_bus().send(entry);
    crate::pane_wait_notify::bump_waiters();
}

pub fn subscribe() -> broadcast::Receiver<EventEntry> {
    event_bus().subscribe()
}

pub fn last_pane_event_summary(pane_id: &str) -> Option<LastEventSummary> {
    LAST_PANE_EVENT.lock().get(pane_id).cloned()
}

fn event_pane_id(payload: &SystemEvent) -> Option<PaneId> {
    match payload {
        SystemEvent::PaneSpawned { pane_id, .. }
        | SystemEvent::PaneKilled { pane_id }
        | SystemEvent::PaneInputWritten { pane_id, .. }
        | SystemEvent::PaneOutputObserved { pane_id, .. }
        | SystemEvent::PaneStatusChanged { pane_id, .. }
        | SystemEvent::PaneRoleSet { pane_id, .. }
        | SystemEvent::PaneDigestUpdated { pane_id, .. }
        | SystemEvent::AgentObservation { pane_id, .. }
        | SystemEvent::OpenCodeKeySwap { pane_id, .. }
        | SystemEvent::PaneModelSwitched { pane_id, .. }
        | SystemEvent::PaneTuiReattached { pane_id, .. } => Some(pane_id.clone()),
        SystemEvent::DelegationPrepared { target_pane_id, .. } => target_pane_id.clone(),
        _ => None,
    }
}

fn event_type_name(payload: &SystemEvent) -> &'static str {
    match payload {
        SystemEvent::PaneSpawned { .. } => "PaneSpawned",
        SystemEvent::PaneKilled { .. } => "PaneKilled",
        SystemEvent::PaneInputWritten { .. } => "PaneInputWritten",
        SystemEvent::PaneOutputObserved { .. } => "PaneOutputObserved",
        SystemEvent::PaneStatusChanged { .. } => "PaneStatusChanged",
        SystemEvent::McpToolCalled { .. } => "McpToolCalled",
        SystemEvent::McpToolCompleted { .. } => "McpToolCompleted",
        SystemEvent::TaskCreated { .. } => "TaskCreated",
        SystemEvent::TaskClaimed { .. } => "TaskClaimed",
        SystemEvent::TaskLeaseRenewed { .. } => "TaskLeaseRenewed",
        SystemEvent::TaskStatusUpdated { .. } => "TaskStatusUpdated",
        SystemEvent::TaskCompleted { .. } => "TaskCompleted",
        SystemEvent::TaskBlocked { .. } => "TaskBlocked",
        SystemEvent::ReviewerAssigned { .. } => "ReviewerAssigned",
        SystemEvent::ResourceLockAcquired { .. } => "ResourceLockAcquired",
        SystemEvent::ResourceLockConflict { .. } => "ResourceLockConflict",
        SystemEvent::ResourceLockReleased { .. } => "ResourceLockReleased",
        SystemEvent::ResourceLockExpired { .. } => "ResourceLockExpired",
        SystemEvent::AgentObservation { .. } => "AgentObservation",
        SystemEvent::SessionGoalUpdated { .. } => "SessionGoalUpdated",
        SystemEvent::PaneRoleSet { .. } => "PaneRoleSet",
        SystemEvent::PaneDigestUpdated { .. } => "PaneDigestUpdated",
        SystemEvent::DelegationPrepared { .. } => "DelegationPrepared",
        SystemEvent::OrchestratorStandbyPolicyUpdated { .. } => "OrchestratorStandbyPolicyUpdated",
        SystemEvent::OpenCodeKeySwap { .. } => "OpenCodeKeySwap",
        SystemEvent::PaneModelSwitched { .. } => "PaneModelSwitched",
        SystemEvent::PaneTuiReattached { .. } => "PaneTuiReattached",
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EventId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CommandId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TaskId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PaneId(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ResourceId(pub String);

impl EventId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }
}

impl CommandId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }
}

impl TaskId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }
}

impl ResourceId {
    pub fn from_parts(resource_type: &str, name: &str) -> Self {
        Self(format!("{resource_type}:{name}"))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEntry {
    pub id: EventId,
    pub timestamp_ms: i64,
    pub actor: ActorId,
    pub correlation_id: CommandId,
    pub payload: SystemEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "PascalCase")]
pub enum SystemEvent {
    PaneSpawned {
        pane_id: PaneId,
        agent_type: String,
        pid: u32,
        cwd: String,
        cols: u16,
        rows: u16,
    },
    PaneKilled {
        pane_id: PaneId,
    },
    PaneInputWritten {
        pane_id: PaneId,
        byte_count: usize,
        append_newline: bool,
    },
    PaneOutputObserved {
        pane_id: PaneId,
        byte_count: usize,
    },
    PaneStatusChanged {
        pane_id: PaneId,
        status: String,
    },
    McpToolCalled {
        tool: String,
    },
    McpToolCompleted {
        tool: String,
        ok: bool,
        status: u16,
    },
    TaskCreated {
        task_id: TaskId,
        title: String,
        exclusive: bool,
    },
    TaskClaimed {
        task_id: TaskId,
        agent_id: String,
        lease_expires_at_ms: i64,
    },
    TaskLeaseRenewed {
        task_id: TaskId,
        agent_id: String,
        lease_expires_at_ms: i64,
    },
    TaskStatusUpdated {
        task_id: TaskId,
        status: String,
    },
    TaskCompleted {
        task_id: TaskId,
        agent_id: String,
        evidence: String,
    },
    TaskBlocked {
        task_id: TaskId,
        agent_id: String,
        reason: String,
    },
    ReviewerAssigned {
        task_id: TaskId,
        reviewer_id: String,
    },
    ResourceLockAcquired {
        resource_id: ResourceId,
        resource_type: String,
        owner_id: String,
        lease_expires_at_ms: Option<i64>,
    },
    ResourceLockConflict {
        resource_id: ResourceId,
        requested_owner_id: String,
        existing_owner_id: String,
    },
    ResourceLockReleased {
        resource_id: ResourceId,
        owner_id: String,
    },
    ResourceLockExpired {
        resource_id: ResourceId,
    },
    AgentObservation {
        pane_id: PaneId,
        agent_type: String,
        observation: String,
        text: Option<String>,
    },
    SessionGoalUpdated {
        current_goal: Option<String>,
    },
    PaneRoleSet {
        pane_id: PaneId,
        role: PaneRole,
    },
    PaneDigestUpdated {
        pane_id: PaneId,
        summary: String,
        source: String,
    },
    DelegationPrepared {
        task_id: Option<TaskId>,
        target_pane_id: Option<PaneId>,
        intent: String,
    },
    OrchestratorStandbyPolicyUpdated {
        standby_poll_ms: u64,
        standby_max_ms: u64,
    },
    OpenCodeKeySwap {
        pane_id: PaneId,
        event: String,
        from_profile: String,
        to_profile: Option<String>,
    },
    PaneModelSwitched {
        pane_id: PaneId,
        provider_id: String,
        model_id: String,
    },
    PaneTuiReattached {
        pane_id: PaneId,
        attach_generation: u64,
    },
}

impl EventEntry {
    pub fn new(actor: ActorId, correlation_id: CommandId, payload: SystemEvent) -> Self {
        Self {
            id: EventId::new(),
            timestamp_ms: now_ms(),
            actor,
            correlation_id,
            payload,
        }
    }
}
