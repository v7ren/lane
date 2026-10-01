use crate::protocol::{AgentError, AgentEvent, CodexThreadOptions};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;

pub struct CodexWsClient;

fn disabled() -> AgentError {
    AgentError::Unsupported("codex-ws disabled".into())
}

impl CodexWsClient {
    pub fn spawn(_ws_url: String) -> Result<Arc<Self>, AgentError> {
        Err(AgentError::Connect("codex-ws disabled".into()))
    }

    pub fn spawn_new_thread(
        _ws_url: String,
        _cwd: String,
        _thread_options: CodexThreadOptions,
    ) -> Result<Arc<Self>, AgentError> {
        Self::spawn(String::new())
    }

    pub fn spawn_with_thread(
        _ws_url: String,
        _thread_id: String,
        _cwd: String,
        _thread_options: CodexThreadOptions,
    ) -> Result<Arc<Self>, AgentError> {
        Self::spawn(String::new())
    }

    pub fn start_thread_blocking(
        _ws_url: String,
        _cwd: String,
        _thread_options: CodexThreadOptions,
        _timeout: Duration,
    ) -> Result<(Arc<Self>, String), AgentError> {
        Err(AgentError::Connect("codex-ws disabled".into()))
    }

    pub fn thread_id(&self) -> Option<String> {
        None
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        let (tx, rx) = broadcast::channel(1);
        drop(tx);
        rx
    }

    pub fn emit_local(&self, _event: AgentEvent) {}

    pub fn send_rpc(&self, _value: Value) -> Result<(), AgentError> {
        Err(disabled())
    }

    pub fn send_turn(&self, _text: &str) -> Result<(), AgentError> {
        Err(disabled())
    }

    pub fn send_turn_with_policy(
        &self,
        _text: &str,
        _approval_policy: Option<&str>,
    ) -> Result<(), AgentError> {
        Err(disabled())
    }

    pub fn interrupt(&self) -> Result<(), AgentError> {
        Err(disabled())
    }

    pub fn respond_approval_rpc(
        &self,
        _request_id: &str,
        _decision: &str,
    ) -> Result<(), AgentError> {
        Err(disabled())
    }
}
