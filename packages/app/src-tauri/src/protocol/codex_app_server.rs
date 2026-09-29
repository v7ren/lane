//! Codex `app-server` WebSocket adapter (minimal; version fallback to TUI-only is manifest-driven).

use super::types::{
    AgentError, AgentEvent, Capabilities, Endpoint, ProtocolAdapter, ProtocolSession,
};
use crate::agents::ProtocolKind;
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct CodexAppServerAdapter;

impl ProtocolAdapter for CodexAppServerAdapter {
    fn protocol(&self) -> ProtocolKind {
        ProtocolKind::CodexAppServer
    }

    fn connect(&self, endpoint: Endpoint) -> Result<Box<dyn ProtocolSession>, AgentError> {
        Ok(Box::new(CodexAppServerSession {
            endpoint: endpoint.url,
        }))
    }
}

struct CodexAppServerSession {
    endpoint: String,
}

impl ProtocolSession for CodexAppServerSession {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            chat: true,
            approvals: true,
            cancel_turn: true,
            file_changes: false,
        }
    }

    fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        let (_tx, rx) = broadcast::channel(8);
        rx
    }

    fn send_prompt(&self, text: String) -> Result<(), AgentError> {
        // Full WS JSON-RPC lands in a follow-up; composer can still route to TUI when unsupported.
        tracing::debug!(endpoint = %self.endpoint, len = text.len(), "codex app-server prompt (stub)");
        Err(AgentError::Unsupported(
            "codex app-server wire protocol not connected in this build — use TUI pane".into(),
        ))
    }

    fn respond_to_approval(&self, _approved: bool, _remember: bool) -> Result<(), AgentError> {
        Err(AgentError::Unsupported("codex app-server approval stub".into()))
    }

    fn cancel_turn(&self) -> Result<(), AgentError> {
        Err(AgentError::Unsupported("codex app-server cancel stub".into()))
    }
}

pub fn adapter() -> Arc<dyn ProtocolAdapter> {
    Arc::new(CodexAppServerAdapter)
}
