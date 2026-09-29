//! Codex app-server WebSocket client (blocking tungstenite, shared thread via thread/resume).

use crate::protocol::codex_notifications::{map_codex_notification, map_codex_server_request};
use crate::protocol::{AgentError, AgentEvent, CodexThreadOptions};
use serde_json::{json, Value};
use std::net::TcpStream;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;
use tungstenite::{connect, stream::MaybeTlsStream, Message, WebSocket};

pub struct CodexWsClient {
    events_tx: broadcast::Sender<AgentEvent>,
    request_tx: std::sync::mpsc::Sender<Value>,
    thread_id: Arc<parking_lot::Mutex<Option<String>>>,
    active_turn_id: Arc<parking_lot::Mutex<Option<String>>>,
    turn_counter: Arc<AtomicU64>,
    _thread_options: CodexThreadOptions,
}

impl CodexWsClient {
    pub fn spawn(ws_url: String) -> Result<Arc<Self>, AgentError> {
        Self::spawn_with_thread(
            ws_url,
            uuid::Uuid::new_v4().to_string(),
            std::env::temp_dir().to_string_lossy().to_string(),
            CodexThreadOptions::default(),
        )
    }

    pub fn spawn_with_thread(
        ws_url: String,
        thread_id: String,
        cwd: String,
        thread_options: CodexThreadOptions,
    ) -> Result<Arc<Self>, AgentError> {
        let (events_tx, _) = broadcast::channel(256);
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        let thread_slot = Arc::new(parking_lot::Mutex::new(Some(thread_id.clone())));
        let active_turn_id = Arc::new(parking_lot::Mutex::new(None));
        let turn_counter = Arc::new(AtomicU64::new(1));
        let client = Arc::new(Self {
            events_tx: events_tx.clone(),
            request_tx,
            thread_id: Arc::clone(&thread_slot),
            active_turn_id: Arc::clone(&active_turn_id),
            turn_counter: Arc::clone(&turn_counter),
            _thread_options: thread_options.clone(),
        });
        let events_err = events_tx.clone();
        std::thread::Builder::new()
            .name("codex-ws".into())
            .spawn(move || {
                if let Err(message) = run_ws_loop(
                    ws_url,
                    events_tx,
                    request_rx,
                    thread_slot,
                    turn_counter,
                    thread_id,
                    cwd,
                    thread_options,
                    Arc::clone(&active_turn_id),
                )
                {
                    let _ = events_err.send(AgentEvent::Error { message });
                }
            })
            .map_err(|e| AgentError::Connect(format!("spawn codex ws: {e}")))?;
        Ok(client)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.events_tx.subscribe()
    }

    pub fn emit_local(&self, event: AgentEvent) {
        let _ = self.events_tx.send(event);
    }

    pub fn send_rpc(&self, value: Value) -> Result<(), AgentError> {
        self.request_tx
            .send(value)
            .map_err(|e| AgentError::Protocol(format!("codex ws send: {e}")))
    }

    pub fn send_turn(&self, text: &str) -> Result<(), AgentError> {
        self.send_turn_with_policy(text, None)?;
        Ok(())
    }

    pub fn send_turn_with_policy(
        &self,
        text: &str,
        approval_policy: Option<&str>,
    ) -> Result<(), AgentError> {
        let thread_id = self
            .thread_id
            .lock()
            .clone()
            .ok_or_else(|| AgentError::Protocol("codex thread not ready".into()))?;
        let turn_id = self.turn_counter.fetch_add(1, Ordering::SeqCst).to_string();
        *self.active_turn_id.lock() = Some(turn_id.clone());
        let mut params = json!({
            "threadId": thread_id,
            "input": [{ "type": "text", "text": text }],
        });
        if let Some(policy) = approval_policy {
            params["approvalPolicy"] = json!(policy);
        }
        self.send_rpc(json!({
            "jsonrpc": "2.0",
            "id": format!("turn-{turn_id}"),
            "method": "turn/start",
            "params": params,
        }))
    }

    pub fn interrupt(&self) -> Result<(), AgentError> {
        let thread_id = self
            .thread_id
            .lock()
            .clone()
            .ok_or_else(|| AgentError::Protocol("codex thread not ready".into()))?;
        let turn_id = self
            .active_turn_id
            .lock()
            .clone()
            .ok_or_else(|| AgentError::Protocol("codex turn not active".into()))?;
        self.send_rpc(json!({
            "jsonrpc": "2.0",
            "id": "interrupt",
            "method": "turn/interrupt",
            "params": { "threadId": thread_id, "turnId": turn_id }
        }))
    }

    pub fn respond_approval_rpc(
        &self,
        request_id: &str,
        decision: &str,
    ) -> Result<(), AgentError> {
        let codex_decision = match decision {
            "allow_once" => "accept",
            "allow_always" => "acceptForSession",
            "deny" => "decline",
            other => {
                return Err(AgentError::Protocol(format!(
                    "unsupported codex approval decision {other}"
                )));
            }
        };
        self.send_rpc(json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": { "decision": codex_decision }
        }))
    }

}

fn run_ws_loop(
    ws_url: String,
    events_tx: broadcast::Sender<AgentEvent>,
    request_rx: std::sync::mpsc::Receiver<Value>,
    thread_id_slot: Arc<parking_lot::Mutex<Option<String>>>,
    turn_counter: Arc<AtomicU64>,
    resume_thread_id: String,
    cwd: String,
    thread_options: CodexThreadOptions,
    active_turn_id: Arc<parking_lot::Mutex<Option<String>>>,
) -> Result<(), String> {
    let (mut ws, _) = connect(&ws_url).map_err(|e| format!("codex ws connect: {e}"))?;
    set_read_timeout(&mut ws)?;

    send_json(
        &mut ws,
        json!({
            "jsonrpc": "2.0",
            "id": "init",
            "method": "initialize",
            "params": { "clientInfo": { "name": "loomria", "version": env!("CARGO_PKG_VERSION") } }
        }),
    )?;
    let mut thread_params = json!({
        "threadId": resume_thread_id,
        "cwd": cwd,
    });
    if let Some(policy) = thread_options.approval_policy.clone() {
        thread_params["approvalPolicy"] = policy;
    }
    if let Some(sandbox) = thread_options.sandbox_policy.clone() {
        thread_params["sandboxPolicy"] = sandbox;
    }
    send_json(
        &mut ws,
        json!({
            "jsonrpc": "2.0",
            "id": "thread-start",
            "method": "thread/start",
            "params": thread_params,
        }),
    )?;
    *thread_id_slot.lock() = Some(resume_thread_id);

    loop {
        while let Ok(value) = request_rx.try_recv() {
            send_json(&mut ws, value)?;
        }
        match ws.read() {
            Ok(Message::Text(text)) => {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    if let Some(id) = value
                        .pointer("/result/thread/id")
                        .and_then(|v| v.as_str())
                        .or_else(|| value.pointer("/result/threadId").and_then(|v| v.as_str()))
                    {
                        *thread_id_slot.lock() = Some(id.to_string());
                    }
                    if value.get("method").is_some()
                        && value.get("id").is_some()
                        && value.get("result").is_none()
                        && value.get("error").is_none()
                    {
                        if let Some(turn) = value
                            .pointer("/params/turnId")
                            .and_then(|v| v.as_str())
                            .or_else(|| value.pointer("/params/turn/id").and_then(|v| v.as_str()))
                        {
                            *active_turn_id.lock() = Some(turn.to_string());
                        }
                        for event in map_codex_server_request(&value, &turn_counter) {
                            let _ = events_tx.send(event);
                        }
                    } else {
                        if let Some(turn) = value
                            .pointer("/params/turnId")
                            .and_then(|v| v.as_str())
                            .or_else(|| value.pointer("/params/turn/id").and_then(|v| v.as_str()))
                        {
                            *active_turn_id.lock() = Some(turn.to_string());
                        }
                        for event in map_codex_notification(&value, &turn_counter, &active_turn_id) {
                            let _ = events_tx.send(event);
                        }
                    }
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(ref e))
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(format!("read: {e}")),
        }
    }
    Err("codex ws closed".into())
}

fn tcp_from_maybe_tls(stream: &MaybeTlsStream<TcpStream>) -> Result<&TcpStream, String> {
    match stream {
        MaybeTlsStream::Plain(s) => Ok(s),
        MaybeTlsStream::Rustls(s) => Ok(s.get_ref()),
        _ => Err("unsupported MaybeTlsStream variant".into()),
    }
}

fn set_read_timeout(ws: &mut WebSocket<MaybeTlsStream<TcpStream>>) -> Result<(), String> {
    tcp_from_maybe_tls(ws.get_ref())?
        .set_read_timeout(Some(Duration::from_millis(50)))
        .map_err(|e| format!("read timeout: {e}"))
}

fn send_json(ws: &mut WebSocket<MaybeTlsStream<TcpStream>>, value: Value) -> Result<(), String> {
    ws.send(Message::Text(value.to_string()))
        .map_err(|e| format!("send: {e}"))
}
