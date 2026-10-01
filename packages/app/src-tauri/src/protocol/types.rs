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
        /// Structured form of the request (spec 2.3); `detail` stays the one-line summary.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        payload: Option<serde_json::Value>,
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        context_tokens: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        context_window: Option<u64>,
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
    /// A stable-id notice; a later Notice with the same id replaces the earlier one.
    Notice {
        id: String,
        level: NoticeLevel,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        action: Option<NoticeAction>,
        /// Sticky notices render as a chip above the composer, not as a transcript row.
        #[serde(default)]
        sticky: bool,
        /// Removes the notice with this id (text ignored).
        #[serde(default)]
        cleared: bool,
    },
    PlanUpdated {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        turn_id: Option<String>,
        /// Full list each time (replace, not merge).
        items: Vec<PlanItem>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        explanation: Option<String>,
    },
    /// Ephemeral live tool output; coalesced per `tool_id`, never stored in history.
    ToolOutputDelta {
        turn_id: String,
        tool_id: String,
        chunk: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum NoticeAction {
    RetryChat,
    OpenTerminal,
    FocusTerminal,
    BackToChat,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlanItem {
    pub text: String,
    pub status: PlanStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlanStatus {
    Pending,
    InProgress,
    Done,
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
    /// Hub registration this event belongs to (`PaneProtocol.generation`); changes on re-register.
    #[serde(default)]
    pub epoch: u64,
    /// Event came from history replay (session file / thread/read), not the live stream.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub replayed: bool,
    /// Wall-clock ms when the hub committed it (live) or the record timestamp (replay, if known).
    #[serde(default)]
    pub ts_ms: i64,
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
                payload: Some(serde_json::json!({"type": "command", "command": "git status"})),
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
                context_tokens: Some(3),
                context_window: Some(200_000),
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
            AgentEvent::Notice {
                id: "n1".into(),
                level: NoticeLevel::Warning,
                text: "careful".into(),
                source: Some("codex".into()),
                action: Some(NoticeAction::RetryChat),
                sticky: true,
                cleared: false,
            },
            AgentEvent::PlanUpdated {
                turn_id: Some("t1".into()),
                items: vec![PlanItem {
                    text: "step".into(),
                    status: PlanStatus::InProgress,
                }],
                explanation: None,
            },
            AgentEvent::ToolOutputDelta {
                turn_id: "t1".into(),
                tool_id: "tool1".into(),
                chunk: "out".into(),
            },
        ];

        for event in samples {
            let value = serde_json::to_value(&event).expect("serialize");
            assert_eq!(value.get("type").and_then(|v| v.as_str()), Some(expected_type(&event)));
            let back: AgentEvent = serde_json::from_value(value.clone()).expect("deserialize");
            assert_eq!(serde_json::to_value(&back).expect("reserialize"), value);
        }
    }

    #[test]
    fn new_variants_serialize_to_spec_shapes() {
        let notice = serde_json::to_value(AgentEvent::Notice {
            id: "n".into(),
            level: NoticeLevel::Error,
            text: "t".into(),
            source: None,
            action: Some(NoticeAction::BackToChat),
            sticky: false,
            cleared: false,
        })
        .unwrap();
        assert_eq!(notice["level"], "error");
        assert_eq!(notice["action"], serde_json::json!({"kind": "back_to_chat"}));
        assert!(notice.get("source").is_none());
        // Every new field is optional on input.
        let parsed: AgentEvent =
            serde_json::from_str(r#"{"type":"notice","id":"n","level":"info","text":"x"}"#).unwrap();
        assert!(matches!(
            parsed,
            AgentEvent::Notice { sticky: false, cleared: false, action: None, .. }
        ));
        let plan = serde_json::to_value(AgentEvent::PlanUpdated {
            turn_id: None,
            items: vec![PlanItem { text: "a".into(), status: PlanStatus::InProgress }],
            explanation: None,
        })
        .unwrap();
        assert_eq!(plan["items"][0]["status"], "in_progress");
        assert!(plan.get("turn_id").is_none());
        // Old Usage / ApprovalRequested JSON still parses.
        let usage: AgentEvent =
            serde_json::from_str(r#"{"type":"usage","input_tokens":1}"#).unwrap();
        assert!(matches!(
            usage,
            AgentEvent::Usage { context_tokens: None, context_window: None, .. }
        ));
        let approval: AgentEvent = serde_json::from_str(
            r#"{"type":"approval_requested","approval_id":"a","title":"t","detail":"d","kind":"command","options":["deny"]}"#,
        )
        .unwrap();
        assert!(matches!(approval, AgentEvent::ApprovalRequested { payload: None, .. }));
    }

    #[test]
    fn envelope_new_fields_default_and_skip() {
        let env: AgentEventEnvelope = serde_json::from_str(
            r#"{"pane_id":"p","seq":1,"event":{"type":"turn_started","turn_id":"t"}}"#,
        )
        .unwrap();
        assert_eq!((env.epoch, env.replayed, env.ts_ms), (0, false, 0));
        let v = serde_json::to_value(&env).unwrap();
        assert!(v.get("replayed").is_none());
        assert_eq!(v["epoch"], 0);
        let replayed = AgentEventEnvelope { replayed: true, epoch: 2, ts_ms: 5, ..env };
        let v = serde_json::to_value(&replayed).unwrap();
        assert_eq!(v["replayed"], true);
        assert_eq!(v["epoch"], 2);
        assert_eq!(v["ts_ms"], 5);
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
            AgentEvent::Notice { .. } => "notice",
            AgentEvent::PlanUpdated { .. } => "plan_updated",
            AgentEvent::ToolOutputDelta { .. } => "tool_output_delta",
        }
    }
}
