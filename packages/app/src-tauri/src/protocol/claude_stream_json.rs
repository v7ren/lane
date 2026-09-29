//! Claude `--output-format stream-json` session (headless Shape 3).

use super::types::{
    AgentError, AgentEvent, Capabilities, Endpoint, ProtocolAdapter, ProtocolSession,
};
use crate::agents::ProtocolKind;
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct ClaudeStreamJsonAdapter;

impl ProtocolAdapter for ClaudeStreamJsonAdapter {
    fn protocol(&self) -> ProtocolKind {
        ProtocolKind::ClaudeStreamJson
    }

    fn connect(&self, _endpoint: Endpoint) -> Result<Box<dyn ProtocolSession>, AgentError> {
        Ok(Box::new(ClaudeStreamJsonSession))
    }
}

struct ClaudeStreamJsonSession;

impl ProtocolSession for ClaudeStreamJsonSession {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            chat: true,
            approvals: false,
            cancel_turn: true,
            file_changes: true,
        }
    }

    fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        let (_tx, rx) = broadcast::channel(8);
        rx
    }

    fn send_prompt(&self, text: String) -> Result<(), AgentError> {
        tracing::debug!(len = text.len(), "claude stream-json prompt (stub spawn)");
        Err(AgentError::Unsupported(
            "spawn claude with stream-json via manifest server block (stub)".into(),
        ))
    }

    fn respond_to_approval(&self, _approved: bool, _remember: bool) -> Result<(), AgentError> {
        Err(AgentError::Unsupported("claude stream-json has no approval channel".into()))
    }

    fn cancel_turn(&self) -> Result<(), AgentError> {
        Ok(())
    }
}

pub fn adapter() -> Arc<dyn ProtocolAdapter> {
    Arc::new(ClaudeStreamJsonAdapter)
}
