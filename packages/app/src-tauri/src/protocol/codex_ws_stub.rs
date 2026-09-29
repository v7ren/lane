use crate::protocol::AgentError;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct CodexWsClient;

impl CodexWsClient {
    pub fn spawn(_ws_url: String) -> Result<Arc<Self>, AgentError> {
        Err(AgentError::Connect("codex-ws disabled".into()))
    }

    pub fn spawn_with_thread(
        _ws_url: String,
        _thread_id: String,
    ) -> Result<Arc<Self>, AgentError> {
        Self::spawn(String::new())
    }

    pub fn thread_id(&self) -> Option<String> {
        None
    }

    pub fn subscribe(&self) -> broadcast::Receiver<crate::protocol::AgentEvent> {
        let (tx, rx) = broadcast::channel(1);
        drop(tx);
        rx
    }

    pub fn send_rpc(&self, _value: Value) -> Result<(), AgentError> {
        Err(AgentError::Unsupported("codex-ws disabled".into()))
    }

    pub fn send_turn(&self, _text: &str) -> Result<(), AgentError> {
        Err(AgentError::Unsupported("codex-ws disabled".into()))
    }

    pub fn interrupt(&self) -> Result<(), AgentError> {
        Err(AgentError::Unsupported("codex-ws disabled".into()))
    }
}
