//! Protocol-neutral agent events (terminal bytes stay on the PTY path).

use crate::agents::ProtocolKind;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEvent {
    Message { role: String, text: String },
    ToolCall { name: String, detail: Option<String> },
    ApprovalRequest { prompt: String },
    TurnStarted,
    TurnFinished { summary: Option<String> },
    Error { message: String },
    Usage { input_tokens: Option<u64>, output_tokens: Option<u64> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    pub chat: bool,
    pub approvals: bool,
    pub cancel_turn: bool,
    pub file_changes: bool,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            chat: false,
            approvals: false,
            cancel_turn: false,
            file_changes: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Endpoint {
    pub url: String,
    pub session_id: Option<String>,
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
    fn respond_to_approval(&self, approved: bool, remember: bool) -> Result<(), AgentError>;
    fn cancel_turn(&self) -> Result<(), AgentError>;
}
