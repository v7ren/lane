//! Codex `app-server` WebSocket JSON-RPC client (v2 turn API).

use crate::protocol::{
    AgentError, AgentEvent, ApprovalKind, ApprovalDecision, MessageRole, TurnStatus,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub struct CodexWsClient {
    events_tx: broadcast::Sender<AgentEvent>,
    request_tx: std::sync::mpsc::Sender<Value>,
    request_rx: Arc<parking_lot::Mutex<std::sync::mpsc::Receiver<Value>>>,
    thread_id: Arc<parking_lot::Mutex<Option<String>>>,
    turn_counter: Arc<AtomicU64>,
}

impl CodexWsClient {
    pub fn spawn(ws_url: String) -> Result<Arc<Self>, AgentError> {
        let (events_tx, _) = broadcast::channel(256);
        let (request_tx, request_rx) = std::sync::mpsc::channel::<Value>();
        let thread_id = Arc::new(parking_lot::Mutex::new(None));
        let turn_counter = Arc::new(AtomicU64::new(1));
        let client = Arc::new(Self {
            events_tx: events_tx.clone(),
            request_tx,
            request_rx: Arc::new(parking_lot::Mutex::new(request_rx)),
            thread_id: Arc::clone(&thread_id),
            turn_counter: Arc::clone(&turn_counter),
        });
        let client_for_err = Arc::clone(&client);
        std::thread::Builder::new()
            .name("codex-ws".into())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_multi_thread()
                    .enable_all()
                    .build()
                    .expect("codex runtime");
                if let Err(message) = rt.block_on(run_ws_loop(
                    ws_url,
                    events_tx,
                    Arc::clone(&client_for_err.request_rx),
                    thread_id,
                    turn_counter,
                )) {
                    let _ = client_for_err.events_tx.send(AgentEvent::Error { message });
                }
            })
            .map_err(|e| AgentError::Connect(format!("spawn codex ws: {e}")))?;
        Ok(client)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.events_tx.subscribe()
    }

    pub fn send_rpc(&self, value: Value) -> Result<(), AgentError> {
        self.request_tx
            .send(value)
            .map_err(|e| AgentError::Protocol(format!("codex ws send: {e}")))
    }

    pub fn send_turn(&self, text: &str) -> Result<(), AgentError> {
        let thread_id = self
            .thread_id
            .lock()
            .clone()
            .ok_or_else(|| AgentError::Protocol("codex thread not ready".into()))?;
        let turn_id = self.turn_counter.fetch_add(1, Ordering::SeqCst).to_string();
        let _ = self.events_tx.send(AgentEvent::TurnStarted {
            turn_id: turn_id.clone(),
        });
        self.send_rpc(json!({
            "jsonrpc": "2.0",
            "id": format!("turn-{turn_id}"),
            "method": "turn/start",
            "params": {
                "threadId": thread_id,
                "input": [{ "type": "text", "text": text }],
            }
        }))
    }

    pub fn interrupt(&self) -> Result<(), AgentError> {
        let thread_id = self
            .thread_id
            .lock()
            .clone()
            .ok_or_else(|| AgentError::Protocol("codex thread not ready".into()))?;
        self.send_rpc(json!({
            "jsonrpc": "2.0",
            "id": "interrupt",
            "method": "turn/interrupt",
            "params": { "threadId": thread_id }
        }))
    }
}

async fn run_ws_loop(
    ws_url: String,
    events_tx: broadcast::Sender<AgentEvent>,
    request_rx: Arc<parking_lot::Mutex<std::sync::mpsc::Receiver<Value>>>,
    thread_id: Arc<parking_lot::Mutex<Option<String>>>,
    turn_counter: Arc<AtomicU64>,
) -> Result<(), String> {
    let (ws, _) = connect_async(&ws_url)
        .await
        .map_err(|e| format!("codex ws connect: {e}"))?;
    let (mut write, mut read) = ws.split();

    write
        .send(Message::Text(
            json!({
                "jsonrpc": "2.0",
                "id": "init",
                "method": "initialize",
                "params": { "clientInfo": { "name": "loomria", "version": env!("CARGO_PKG_VERSION") } }
            })
            .to_string(),
        ))
        .await
        .map_err(|e| format!("initialize send: {e}"))?;

    write
        .send(Message::Text(
            json!({
                "jsonrpc": "2.0",
                "id": "thread-start",
                "method": "thread/start",
                "params": { "cwd": std::env::temp_dir().to_string_lossy() }
            })
            .to_string(),
        ))
        .await
        .map_err(|e| format!("thread/start send: {e}"))?;

    loop {
        if let Ok(value) = request_rx.lock().try_recv() {
            write
                .send(Message::Text(value.to_string()))
                .await
                .map_err(|e| format!("send: {e}"))?;
        }
        match tokio::time::timeout(std::time::Duration::from_millis(50), read.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    if let Some(id) = value
                        .pointer("/result/thread/id")
                        .and_then(|v| v.as_str())
                        .or_else(|| value.pointer("/result/threadId").and_then(|v| v.as_str()))
                    {
                        *thread_id.lock() = Some(id.to_string());
                    }
                    for event in map_codex_notification(&value, &turn_counter) {
                        let _ = events_tx.send(event);
                    }
                }
            }
            Ok(Some(Ok(_))) => {}
            Ok(Some(Err(e))) => return Err(format!("read: {e}")),
            Ok(None) => break,
            Err(_) => {}
        }
    }
    Err("codex ws closed".into())
}

fn map_codex_notification(value: &Value, turn_counter: &AtomicU64) -> Vec<AgentEvent> {
    let method = value.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let turn_id = turn_counter.load(Ordering::SeqCst).to_string();
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    match method {
        "turn/started" => vec![AgentEvent::TurnStarted {
            turn_id: params
                .get("turnId")
                .and_then(|v| v.as_str())
                .unwrap_or(&turn_id)
                .to_string(),
        }],
        "turn/completed" => vec![AgentEvent::TurnCompleted {
            turn_id,
            status: TurnStatus::Ok,
            error: None,
        }],
        "item/agentMessage/delta" | "thread/item/delta" => {
            let text = params
                .get("delta")
                .and_then(|d| d.as_str())
                .unwrap_or("");
            vec![AgentEvent::MessageDelta {
                turn_id,
                message_id: params
                    .get("itemId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("assistant")
                    .to_string(),
                role: MessageRole::Assistant,
                text: text.to_string(),
            }]
        }
        "turn/tokenUsage/updated" => vec![AgentEvent::Usage {
            input_tokens: params
                .pointer("/usage/inputTokens")
                .and_then(|v| v.as_u64()),
            output_tokens: params
                .pointer("/usage/outputTokens")
                .and_then(|v| v.as_u64()),
            cost_usd: None,
        }],
        "exec/command/requestApproval" | "command/requestApproval" => vec![AgentEvent::ApprovalRequested {
            approval_id: params
                .get("requestId")
                .and_then(|v| v.as_str())
                .unwrap_or("approval")
                .to_string(),
            title: "Command approval".into(),
            detail: params
                .get("command")
                .map(|v| v.to_string())
                .unwrap_or_default(),
            kind: ApprovalKind::Command,
            options: vec![
                ApprovalDecision::AllowOnce,
                ApprovalDecision::AllowAlways,
                ApprovalDecision::Deny,
            ],
        }],
        _ => Vec::new(),
    }
}
