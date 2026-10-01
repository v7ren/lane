//! Codex `app-server` WebSocket adapter.

use super::types::{
    AgentError, AgentEvent, ApprovalDecision, Capabilities, Endpoint, ProtocolAdapter,
    ProtocolSession,
};
use crate::agents::ProtocolKind;
use crate::protocol::CodexWsClient;
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct CodexAppServerAdapter;

impl ProtocolAdapter for CodexAppServerAdapter {
    fn protocol(&self) -> ProtocolKind {
        ProtocolKind::CodexAppServer
    }

    fn connect(&self, endpoint: Endpoint) -> Result<Box<dyn ProtocolSession>, AgentError> {
        let cwd = endpoint
            .cwd
            .clone()
            .unwrap_or_else(|| std::env::temp_dir().to_string_lossy().to_string());
        let thread_options = endpoint.codex.clone().unwrap_or_else(|| {
            crate::protocol::CodexThreadOptions {
                approval_policy: Some(serde_json::json!("on-request")),
                sandbox_policy: Some(serde_json::json!("workspace-write")),
            }
        });
        let client = if let Some(thread_id) = endpoint.session_id.clone() {
            CodexWsClient::spawn_with_thread(endpoint.url, thread_id, cwd, thread_options)?
        } else {
            CodexWsClient::spawn_new_thread(endpoint.url, cwd, thread_options)?
        };
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
            file_changes: true,
            attach_tui: true,
        }
    }

    fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.client.subscribe()
    }

    fn send_prompt(&self, text: String) -> Result<(), AgentError> {
        let policy = std::env::var("LOOMRIA_CODEX_TURN_APPROVAL").ok();
        match policy.as_deref() {
            Some(policy) => self.client.send_turn_with_policy(&text, Some(policy)),
            None => self.client.send_turn(&text),
        }
    }

    fn respond_to_approval(&self, approval_id: &str, decision: &str) -> Result<(), AgentError> {
        let (wire, resolved) = match route_decision(decision)? {
            Routed::Answer => (decision.to_string(), ApprovalDecision::AllowOnce),
            Routed::Decision(parsed) => (parsed.as_str().to_string(), parsed),
        };
        self.client.respond_approval_rpc(approval_id, &wire)?;
        let _ = self.client.emit_local(AgentEvent::ApprovalResolved {
            approval_id: approval_id.to_string(),
            decision: resolved,
        });
        Ok(())
    }

    fn cancel_turn(&self) -> Result<(), AgentError> {
        self.client.interrupt()
    }
}

/// How a decision string from the frontend is handled.
#[derive(Debug, PartialEq)]
enum Routed {
    /// A question answer (`answer:{...}`), forwarded verbatim to the RPC.
    Answer,
    /// An ordinary approval decision.
    Decision(ApprovalDecision),
}

fn route_decision(decision: &str) -> Result<Routed, AgentError> {
    if decision.starts_with(super::claude_stream_json::ANSWER_PREFIX) {
        return Ok(Routed::Answer);
    }
    ApprovalDecision::parse(decision)
        .map(Routed::Decision)
        .map_err(AgentError::Protocol)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answer_decisions_route_to_answer() {
        let r = route_decision(r#"answer:{"Colour?":"blue"}"#).unwrap();
        assert_eq!(r, Routed::Answer);
    }

    #[test]
    fn ordinary_decisions_still_parse() {
        let r = route_decision("allow_once").unwrap();
        assert_eq!(r, Routed::Decision(ApprovalDecision::AllowOnce));
        assert!(route_decision("bogus").is_err());
    }
}

pub fn adapter() -> Arc<dyn ProtocolAdapter> {
    Arc::new(CodexAppServerAdapter)
}
