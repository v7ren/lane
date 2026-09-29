mod claude_stream_json;
mod codex_app_server;
mod codex_ws;
mod opencode_http;
mod types;

pub use types::{
    AgentError, AgentEvent, AgentEventEnvelope, ApprovalDecision, ApprovalKind, Capabilities,
    Endpoint, MessageRole, ProtocolAdapter, ProtocolSession, ToolStatus, TurnStatus,
    AGENT_EVENT_CHANNEL, HISTORY_CAP,
};
pub use crate::agents::ProtocolKind;

use std::sync::Arc;

pub fn adapter_for(kind: ProtocolKind) -> Option<Arc<dyn ProtocolAdapter>> {
    match kind {
        ProtocolKind::OpencodeHttp => Some(opencode_http::adapter()),
        ProtocolKind::CodexAppServer => Some(codex_app_server::adapter()),
        ProtocolKind::ClaudeStreamJson => Some(claude_stream_json::adapter()),
        ProtocolKind::None | ProtocolKind::Acp => None,
    }
}
