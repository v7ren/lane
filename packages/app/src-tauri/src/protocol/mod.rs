pub mod claude_mirror;
pub mod claude_session_file;
pub mod claude_stream_json;
mod codex_app_server;
pub mod codex_notifications;
#[cfg(feature = "codex-ws")]
mod codex_ws;
#[cfg(not(feature = "codex-ws"))]
mod codex_ws_stub;
mod opencode_http;
mod event_contract;
mod types;

#[cfg(not(feature = "codex-ws"))]
pub(crate) use codex_ws_stub::CodexWsClient;
#[cfg(feature = "codex-ws")]
pub(crate) use codex_ws::CodexWsClient;

pub use event_contract::{
    assert_approval_flow_contract, assert_no_error_events, assert_prompt_turn_contract,
    assert_turn_completed_is_last_turn_scoped, assemble_assistant_text,
    is_claude_auth_failure_text, latest_turn_id,
};
pub use types::{
    AgentError, AgentEvent, AgentEventEnvelope, ApprovalDecision, ApprovalKind, Capabilities,
    CodexThreadOptions, Endpoint, MessageContentKind, MessageRole, MessageTextMode,
    NoticeAction, NoticeLevel, PlanItem, PlanStatus, ProtocolAdapter, ProtocolSession, ToolStatus, TurnStatus, AGENT_EVENT_CHANNEL, HISTORY_CAP,
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
