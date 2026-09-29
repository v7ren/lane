//! OpenCode HTTP (`opencode serve`) — reference `ProtocolSession` over existing client.

use super::types::{
    AgentError, AgentEvent, ApprovalDecision, Capabilities, Endpoint, ProtocolAdapter,
    ProtocolSession,
};
use crate::agents::ProtocolKind as ManifestProtocol;
use crate::opencode::event_map::next_turn;
use crate::opencode::event_stream::spawn_event_reader;
use std::sync::atomic::AtomicU64;
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
        let (tx, _rx) = broadcast::channel(256);
        let turn_counter = Arc::new(AtomicU64::new(1));
        let _sse = spawn_event_reader(
            endpoint.url.clone(),
            session_id.clone(),
            tx.clone(),
            Arc::clone(&turn_counter),
        );
        Ok(Box::new(OpenCodeHttpSession {
            base_url: endpoint.url,
            session_id,
            directory: endpoint.cwd,
            events_tx: tx,
            turn_counter,
        }))
    }
}

struct OpenCodeHttpSession {
    base_url: String,
    session_id: String,
    directory: Option<String>,
    events_tx: broadcast::Sender<AgentEvent>,
    turn_counter: Arc<AtomicU64>,
}

impl OpenCodeHttpSession {
    fn directory(&self) -> Option<&str> {
        self.directory.as_deref()
    }
}

impl ProtocolSession for OpenCodeHttpSession {
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
        self.events_tx.subscribe()
    }

    fn send_prompt(&self, text: String) -> Result<(), AgentError> {
        let turn_id = next_turn(&self.turn_counter);
        let _ = self.events_tx.send(AgentEvent::TurnStarted {
            turn_id: turn_id.clone(),
        });
        crate::opencode::client::prompt_async(
            &self.base_url,
            &self.session_id,
            self.directory(),
            &text,
            None,
        )
        .map_err(|e| AgentError::Protocol(format!("{e:?}")))?;
        Ok(())
    }

    fn respond_to_approval(&self, approval_id: &str, decision: &str) -> Result<(), AgentError> {
        let parsed = ApprovalDecision::parse(decision)
            .map_err(|e| AgentError::Protocol(e))?;
        let reply = match parsed {
            ApprovalDecision::AllowOnce => "once",
            ApprovalDecision::AllowAlways => "always",
            ApprovalDecision::Deny => "reject",
        };
        crate::opencode::client::reply_permission(&self.base_url, approval_id, reply)
            .map_err(|e| AgentError::Protocol(e))?;
        let _ = self.events_tx.send(AgentEvent::ApprovalResolved {
            approval_id: approval_id.to_string(),
            decision: parsed,
        });
        Ok(())
    }

    fn cancel_turn(&self) -> Result<(), AgentError> {
        crate::opencode::client::abort_session(
            &self.base_url,
            &self.session_id,
            self.directory(),
        )
        .map_err(|e| AgentError::Protocol(e))?;
        let turn_id = self.turn_counter.load(std::sync::atomic::Ordering::SeqCst).to_string();
        let _ = self.events_tx.send(AgentEvent::TurnCompleted {
            turn_id,
            status: crate::protocol::TurnStatus::Cancelled,
            error: None,
        });
        Ok(())
    }
}

pub fn adapter() -> Arc<dyn ProtocolAdapter> {
    Arc::new(OpenCodeHttpAdapter)
}
