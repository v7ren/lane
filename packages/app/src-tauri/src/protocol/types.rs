//! Protocol-neutral agent events (terminal bytes stay on the PTY path).

use crate::agents::ProtocolKind;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

pub const AGENT_EVENT_CHANNEL: &str = "agent://event";
pub const HISTORY_CAP: usize = 2000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    AllowOnce,
    AllowAlways,
    Deny,
}

impl ApprovalDecision {
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim() {
            "allow_once" => Ok(Self::AllowOnce),
            "allow_always" => Ok(Self::AllowAlways),
            "deny" => Ok(Self::Deny),
            other => Err(format!(
                "invalid approval decision {other:?}; expected allow_once | allow_always | deny"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::AllowOnce => "allow_once",
            Self::AllowAlways => "allow_always",
            Self::Deny => "deny",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    pub chat: bool,
    pub send_prompt: bool,
    pub approvals: bool,
    pub cancel: bool,
    pub file_changes: bool,
    pub attach_tui: bool,
}

impl Capabilities {
    pub fn none() -> Self {
        Self {
            chat: false,
            send_prompt: false,
            approvals: false,
            cancel: false,
            file_changes: false,
            attach_tui: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TurnStarted {
        turn_id: String,
    },
    MessageDelta {
        turn_id: String,
        message_id: String,
        role: MessageRole,
        text: String,
        #[serde(default)]
        content_kind: MessageContentKind,
        #[serde(default)]
        text_mode: MessageTextMode,
    },
    MessageCompleted {
        turn_id: String,
        message_id: String,
        role: MessageRole,
        text: String,
        #[serde(default)]
        content_kind: MessageContentKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    MessageMeta {
        turn_id: String,
        message_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        agent: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        model: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    ToolStarted {
        turn_id: String,
        tool_id: String,
        name: String,
        input_summary: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_state: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    ToolCompleted {
        turn_id: String,
        tool_id: String,
        status: ToolStatus,
        output_summary: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_state: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    ApprovalRequested {
        approval_id: String,
        title: String,
        detail: String,
        kind: ApprovalKind,
        options: Vec<ApprovalDecision>,
    },
    ApprovalResolved {
        approval_id: String,
        decision: ApprovalDecision,
    },
    FilesChanged {
        paths: Vec<String>,
    },
    Usage {
        #[serde(skip_serializing_if = "Option::is_none")]
        input_tokens: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output_tokens: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cost_usd: Option<f64>,
    },
    RateLimited {
        #[serde(skip_serializing_if = "Option::is_none")]
        retry_at_ms: Option<i64>,
        message: String,
    },
    TurnCompleted {
        turn_id: String,
        status: TurnStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Error {
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    Assistant,
    User,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MessageContentKind {
    #[default]
    Text,
    Reasoning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum MessageTextMode {
    #[default]
    Append,
    Replace,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Ok,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalKind {
    Command,
    Edit,
    /// The agent is asking the user to choose; `detail` holds the questions as JSON.
    Question,
    /// The agent finished planning; `detail` holds the plan as markdown.
    Plan,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnStatus {
    Ok,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEventEnvelope {
    pub pane_id: String,
    pub seq: u64,
    pub event: AgentEvent,
}

#[derive(Debug, Clone, Default)]
pub struct CodexThreadOptions {
    pub approval_policy: Option<serde_json::Value>,
    pub sandbox_policy: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct Endpoint {
    pub url: String,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub codex: Option<CodexThreadOptions>,
    /// Pane id for SSE fan-out (`opencode://event`).
    pub connect_pane_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("connection failed: {0}")]
    Connect(String),
    #[error("protocol error: {0}")]
    Protocol(String),
}

pub trait ProtocolAdapter: Send + Sync {
    fn protocol(&self) -> ProtocolKind;
    fn connect(&self, endpoint: Endpoint) -> Result<Box<dyn ProtocolSession>, AgentError>;
}

pub trait ProtocolSession: Send + Sync {
    fn capabilities(&self) -> Capabilities;
    fn subscribe(&self) -> broadcast::Receiver<AgentEvent>;
    fn send_prompt(&self, text: String) -> Result<(), AgentError>;
    fn respond_to_approval(&self, approval_id: &str, decision: &str) -> Result<(), AgentError>;
    fn cancel_turn(&self) -> Result<(), AgentError>;
    fn child_pid(&self) -> Option<u32> {
        None
    }
    /// Settings and lists the agent reports about itself (models, slash commands, current
    /// permission mode); `None` when unsupported or not reported yet.
    fn agent_info(&self) -> Option<serde_json::Value> {
        None
    }
    /// Change a session setting (`model` or `permission_mode`).
    fn set_option(&self, key: &str, _value: &str) -> Result<(), AgentError> {
        Err(AgentError::Unsupported(format!("unsupported option {key}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_event_json_contract() {
        let samples: Vec<AgentEvent> = vec![
            AgentEvent::TurnStarted {
                turn_id: "t1".into(),
            },
            AgentEvent::MessageDelta {
                turn_id: "t1".into(),
                message_id: "m1".into(),
                role: MessageRole::Assistant,
                text: "hi".into(),
                content_kind: MessageContentKind::Text,
                text_mode: MessageTextMode::Append,
            },
            AgentEvent::MessageCompleted {
                turn_id: "t1".into(),
                message_id: "m1".into(),
                role: MessageRole::Assistant,
                text: "hello".into(),
                content_kind: MessageContentKind::Text,
                duration_ms: None,
            },
            AgentEvent::MessageMeta {
                turn_id: "t1".into(),
                message_id: "m1".into(),
                agent: Some("build".into()),
                model: Some("mimo-v2.5".into()),
                provider: Some("opencode-go".into()),
                duration_ms: Some(6100),
            },
            AgentEvent::ToolStarted {
                turn_id: "t1".into(),
                tool_id: "tool1".into(),
                name: "bash".into(),
                input_summary: "ls".into(),
                tool_state: Some("running".into()),
                title: None,
            },
            AgentEvent::ToolCompleted {
                turn_id: "t1".into(),
                tool_id: "tool1".into(),
                status: ToolStatus::Ok,
                output_summary: "ok".into(),
                tool_state: Some("completed".into()),
                title: None,
            },
            AgentEvent::ApprovalRequested {
                approval_id: "a1".into(),
                title: "Run command".into(),
                detail: "git status".into(),
                kind: ApprovalKind::Command,
                options: vec![
                    ApprovalDecision::AllowOnce,
                    ApprovalDecision::AllowAlways,
                    ApprovalDecision::Deny,
                ],
            },
            AgentEvent::ApprovalResolved {
                approval_id: "a1".into(),
                decision: ApprovalDecision::AllowOnce,
            },
            AgentEvent::FilesChanged {
                paths: vec!["src/main.rs".into()],
            },
            AgentEvent::Usage {
                input_tokens: Some(1),
                output_tokens: Some(2),
                cost_usd: None,
            },
            AgentEvent::RateLimited {
                retry_at_ms: Some(1_700_000_000_000),
                message: "slow down".into(),
            },
            AgentEvent::TurnCompleted {
                turn_id: "t1".into(),
                status: TurnStatus::Ok,
                error: None,
            },
            AgentEvent::Error {
                message: "boom".into(),
            },
        ];

        for event in samples {
            let value = serde_json::to_value(&event).expect("serialize");
            assert_eq!(value.get("type").and_then(|v| v.as_str()), Some(expected_type(&event)));
        }
    }

    fn expected_type(event: &AgentEvent) -> &'static str {
        match event {
            AgentEvent::TurnStarted { .. } => "turn_started",
            AgentEvent::MessageDelta { .. } => "message_delta",
            AgentEvent::MessageCompleted { .. } => "message_completed",
            AgentEvent::MessageMeta { .. } => "message_meta",
            AgentEvent::ToolStarted { .. } => "tool_started",
            AgentEvent::ToolCompleted { .. } => "tool_completed",
            AgentEvent::ApprovalRequested { .. } => "approval_requested",
            AgentEvent::ApprovalResolved { .. } => "approval_resolved",
            AgentEvent::FilesChanged { .. } => "files_changed",
            AgentEvent::Usage { .. } => "usage",
            AgentEvent::RateLimited { .. } => "rate_limited",
            AgentEvent::TurnCompleted { .. } => "turn_completed",
            AgentEvent::Error { .. } => "error",
        }
    }
}
