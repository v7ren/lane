//! Codex `app-server` WebSocket adapter.

use super::types::{
    AgentError, AgentEvent, ApprovalDecision, Capabilities, Endpoint, ProtocolAdapter,
    ProtocolSession,
};
use crate::agents::ProtocolKind;
use crate::protocol::codex_ws::CodexWsClient;
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct CodexAppServerAdapter;

impl ProtocolAdapter for CodexAppServerAdapter {
    fn protocol(&self) -> ProtocolKind {
        ProtocolKind::CodexAppServer
    }

    fn connect(&self, endpoint: Endpoint) -> Result<Box<dyn ProtocolSession>, AgentError> {
        let client = CodexWsClient::spawn(endpoint.url)?;
        Ok(Box::new(CodexAppServerSession { client }))
    }
}

struct CodexAppServerSession {
    client: Arc<CodexWsClient>,
}

impl ProtocolSession for CodexAppServerSession {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            chat: true,
            send_prompt: true,
            approvals: true,
            cancel: true,
            file_changes: false,
            attach_tui: true,
        }
    }

    fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.client.subscribe()
    }

    fn send_prompt(&self, text: String) -> Result<(), AgentError> {
        self.client.send_turn(&text)
    }

    fn respond_to_approval(&self, approval_id: &str, decision: &str) -> Result<(), AgentError> {
        let parsed = ApprovalDecision::parse(decision)
            .map_err(|e| AgentError::Protocol(e))?;
        let approved = !matches!(parsed, ApprovalDecision::Deny);
        let remember = matches!(parsed, ApprovalDecision::AllowAlways);
        self.client.send_rpc(serde_json::json!({
            "jsonrpc": "2.0",
            "id": format!("approval-{approval_id}"),
            "method": "command/respondApproval",
            "params": {
                "requestId": approval_id,
                "approved": approved,
                "remember": remember,
            }
        }))
    }

    fn cancel_turn(&self) -> Result<(), AgentError> {
        self.client.interrupt()
    }
}

pub fn adapter() -> Arc<dyn ProtocolAdapter> {
    Arc::new(CodexAppServerAdapter)
}
