//! OpenCode HTTP (`opencode serve`) — reference `ProtocolSession` over existing client.

use super::types::{AgentError, AgentEvent, Capabilities, Endpoint, ProtocolAdapter, ProtocolSession};
use crate::agents::ProtocolKind as ManifestProtocol;
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct OpenCodeHttpAdapter;

impl ProtocolAdapter for OpenCodeHttpAdapter {
    fn protocol(&self) -> ManifestProtocol {
        ManifestProtocol::OpencodeHttp
    }

    fn connect(&self, endpoint: Endpoint) -> Result<Box<dyn ProtocolSession>, AgentError> {
        let session_id = endpoint
            .session_id
            .clone()
            .ok_or_else(|| AgentError::Connect("missing session_id".into()))?;
        Ok(Box::new(OpenCodeHttpSession {
            base_url: endpoint.url,
            session_id,
        }))
    }
}

struct OpenCodeHttpSession {
    base_url: String,
    session_id: String,
}

impl ProtocolSession for OpenCodeHttpSession {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            chat: true,
            approvals: true,
            cancel_turn: true,
            file_changes: true,
        }
    }

    fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        let (_tx, rx) = broadcast::channel(16);
        rx
    }

    fn send_prompt(&self, text: String) -> Result<(), AgentError> {
        crate::opencode::client::prompt_async(
            &self.base_url,
            &self.session_id,
            None,
            &text,
            None,
        )
        .map_err(|e| AgentError::Protocol(format!("{e:?}")))?;
        Ok(())
    }

    fn respond_to_approval(&self, _approved: bool, _remember: bool) -> Result<(), AgentError> {
        Err(AgentError::Unsupported(
            "approvals are handled via the attach TUI for OpenCode HTTP".into(),
        ))
    }

    fn cancel_turn(&self) -> Result<(), AgentError> {
        Err(AgentError::Unsupported("cancel via TUI for OpenCode HTTP".into()))
    }
}

pub fn adapter() -> Arc<dyn ProtocolAdapter> {
    Arc::new(OpenCodeHttpAdapter)
}
