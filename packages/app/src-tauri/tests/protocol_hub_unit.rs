//! Real `ProtocolHub` behavior (non-Windows — lib test binary hits STATUS_ENTRYPOINT_NOT_FOUND on Windows).

#![cfg(not(target_os = "windows"))]

use loomria_app_lib::protocol::{AgentEvent, Endpoint, MessageRole, ProtocolAdapter, ProtocolSession};
use loomria_app_lib::agents::ProtocolKind;
use loomria_app_lib::session::ProtocolHub;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

struct FakeSession {
    tx: tokio::sync::broadcast::Sender<AgentEvent>,
}

impl ProtocolSession for FakeSession {
    fn capabilities(&self) -> loomria_app_lib::protocol::Capabilities {
        loomria_app_lib::protocol::Capabilities {
            chat: true,
            send_prompt: true,
            approvals: false,
            cancel: false,
            file_changes: false,
            attach_tui: true,
        }
    }

    fn subscribe(&self) -> tokio::sync::broadcast::Receiver<AgentEvent> {
        self.tx.subscribe()
    }

    fn send_prompt(&self, _: String) -> Result<(), loomria_app_lib::protocol::AgentError> {
        Ok(())
    }

    fn respond_to_approval(
        &self,
        _: &str,
        _: &str,
    ) -> Result<(), loomria_app_lib::protocol::AgentError> {
        Err(loomria_app_lib::protocol::AgentError::Unsupported("n/a".into()))
    }

    fn cancel_turn(&self) -> Result<(), loomria_app_lib::protocol::AgentError> {
        Err(loomria_app_lib::protocol::AgentError::Unsupported("n/a".into()))
    }
}

struct FakeAdapter {
    tx: tokio::sync::broadcast::Sender<AgentEvent>,
}

impl ProtocolAdapter for FakeAdapter {
    fn protocol(&self) -> ProtocolKind {
        ProtocolKind::OpencodeHttp
    }

    fn connect(
        &self,
        _: Endpoint,
    ) -> Result<Box<dyn ProtocolSession>, loomria_app_lib::protocol::AgentError> {
        Ok(Box::new(FakeSession {
            tx: self.tx.clone(),
        }))
    }
}

#[test]
fn hub_seq_ring_and_coalesce() {
    let hub = ProtocolHub::new();
    let (tx, _rx) = tokio::sync::broadcast::channel(16);
    let adapter = Arc::new(FakeAdapter { tx: tx.clone() });
    hub.register(
        "p1".into(),
        adapter,
        Endpoint {
            url: "http://127.0.0.1:1".into(),
            session_id: Some("s".into()),
            cwd: None,
            codex: None,
        },
    )
    .expect("register");

    for i in 0..(loomria_app_lib::protocol::HISTORY_CAP + 3) {
        tx.send(AgentEvent::TurnStarted {
            turn_id: format!("t{i}"),
        })
        .ok();
        thread::sleep(Duration::from_millis(2));
    }
    thread::sleep(Duration::from_millis(60));
    let history = hub.history("p1");
    assert_eq!(history.len(), loomria_app_lib::protocol::HISTORY_CAP);

    for text in ["a", "ab", "abc"] {
        tx.send(AgentEvent::MessageDelta {
            turn_id: "t".into(),
            message_id: "m1".into(),
            role: MessageRole::Assistant,
            text: text.to_string(),
        })
        .ok();
        thread::sleep(Duration::from_millis(5));
    }
    thread::sleep(Duration::from_millis(80));
    let deltas: Vec<_> = hub
        .history("p1")
        .into_iter()
        .filter(|e| matches!(e.event, AgentEvent::MessageDelta { .. }))
        .collect();
    assert_eq!(deltas.len(), 1);
}
