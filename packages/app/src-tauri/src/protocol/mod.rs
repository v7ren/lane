mod claude_stream_json;
mod codex_app_server;
mod codex_notifications;
#[cfg(feature = "codex-ws")]
mod codex_ws;
#[cfg(not(feature = "codex-ws"))]
mod codex_ws_stub;
mod opencode_http;
mod types;

#[cfg(not(feature = "codex-ws"))]
pub(crate) use codex_ws_stub::CodexWsClient;
#[cfg(feature = "codex-ws")]
pub(crate) use codex_ws::CodexWsClient;

pub use types::{
    AgentError, AgentEvent, AgentEventEnvelope, ApprovalDecision, ApprovalKind, Capabilities,
    CodexThreadOptions, Endpoint, MessageRole, ProtocolAdapter, ProtocolSession, ToolStatus,
    TurnStatus, AGENT_EVENT_CHANNEL, HISTORY_CAP,
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
