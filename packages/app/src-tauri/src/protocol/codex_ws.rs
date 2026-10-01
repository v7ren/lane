//! Codex app-server WebSocket client (blocking tungstenite).
//!
//! Handshake (verified against a live Codex 0.159 capture, see
//! `tests/fixtures/codex_raw_turns.jsonl`):
//!   1. `initialize`            -> wait for its response
//!   2. `initialized` (notification, no id)
//!   3. `thread/start {cwd}`    -> NO client supplied thread id; the server returns
//!      `result.thread.id`, which is the only id that may be used for `turn/start`.
//!      (or `thread/resume {threadId}` when attaching to an already created thread)

use crate::protocol::codex_notifications::{
    map_codex_notification, map_codex_server_request, server_request_key,
};
use crate::protocol::{
    AgentError, AgentEvent, CodexThreadOptions, MessageContentKind, MessageRole, MessageTextMode,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tungstenite::{connect, stream::MaybeTlsStream, Message, WebSocket};

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(20);
const INIT_ID: &str = "init";
const THREAD_ID: &str = "thread-start";

type Ws = WebSocket<MaybeTlsStream<TcpStream>>;

#[derive(Clone)]
enum ThreadMode {
    /// `thread/start`: the server allocates the thread id.
    ///
    /// A fresh thread has no rollout on disk until its first turn, so `thread/resume` (and
    /// therefore `codex --remote ... resume <id>`) fails with "no rollout found".
    /// `materialize` sends `thread/name/set`, which (verified live on 0.159) persists the
    /// rollout so the thread can then be resumed by the TUI and by the hub client.
    Start { materialize: bool },
    /// `thread/resume`: attach to a thread created earlier on the same app-server.
    Resume(String),
}

struct LoopState {
    events_tx: broadcast::Sender<AgentEvent>,
    thread_id: Arc<parking_lot::Mutex<Option<String>>>,
    active_turn_id: Arc<parking_lot::Mutex<Option<String>>>,
    turn_counter: Arc<AtomicU64>,
    /// `turn/start` request id -> prompt text, consumed when the response carries the turn id.
    pending_prompts: Arc<parking_lot::Mutex<HashMap<String, String>>>,
    /// Approval id -> the server request waiting for our answer (method and params).
    pending_requests: PendingRequests,
    /// Lets the read loop answer a server request without going through the client.
    reply_tx: std::sync::mpsc::Sender<Value>,
}

type PendingRequests = Arc<parking_lot::Mutex<HashMap<String, (String, Value)>>>;

pub struct CodexWsClient {
    events_tx: broadcast::Sender<AgentEvent>,
    request_tx: std::sync::mpsc::Sender<Value>,
    thread_id: Arc<parking_lot::Mutex<Option<String>>>,
    active_turn_id: Arc<parking_lot::Mutex<Option<String>>>,
    pending_prompts: Arc<parking_lot::Mutex<HashMap<String, String>>>,
    pending_requests: PendingRequests,
    request_seq: AtomicU64,
    materialized: Arc<AtomicBool>,
    startup_error: Arc<parking_lot::Mutex<Option<String>>>,
    thread_options: CodexThreadOptions,
}

impl CodexWsClient {
    /// Connect and `thread/start` (no thread id is sent; the server allocates one).
    pub fn spawn_new_thread(
        ws_url: String,
        cwd: String,
        thread_options: CodexThreadOptions,
    ) -> Result<Arc<Self>, AgentError> {
        Self::spawn_inner(
            ws_url,
            ThreadMode::Start { materialize: false },
            cwd,
            thread_options,
        )
    }

    /// Connect and `thread/resume` an existing server-allocated thread id.
    pub fn spawn_with_thread(
        ws_url: String,
        thread_id: String,
        cwd: String,
        thread_options: CodexThreadOptions,
    ) -> Result<Arc<Self>, AgentError> {
        Self::spawn_inner(ws_url, ThreadMode::Resume(thread_id), cwd, thread_options)
    }

    /// Start a new thread, persist it (so it is resumable) and block until the server has
    /// returned its id. Dropping the returned client closes its socket.
    pub fn start_thread_blocking(
        ws_url: String,
        cwd: String,
        thread_options: CodexThreadOptions,
        timeout: Duration,
    ) -> Result<(Arc<Self>, String), AgentError> {
        let client = Self::spawn_inner(
            ws_url,
            ThreadMode::Start { materialize: true },
            cwd,
            thread_options,
        )?;
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(id) = client.thread_id() {
                if client.materialized.load(Ordering::SeqCst) {
                    return Ok((client, id));
                }
            }
            if let Some(err) = client.startup_error.lock().clone() {
                return Err(AgentError::Connect(err));
            }
            if Instant::now() >= deadline {
                return Err(AgentError::Connect("codex thread/start timed out".into()));
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn spawn_inner(
        ws_url: String,
        mode: ThreadMode,
        cwd: String,
        thread_options: CodexThreadOptions,
    ) -> Result<Arc<Self>, AgentError> {
        let (events_tx, _) = broadcast::channel(256);
        let (request_tx, request_rx) = std::sync::mpsc::channel();
        let thread_slot = Arc::new(parking_lot::Mutex::new(None));
        let active_turn_id = Arc::new(parking_lot::Mutex::new(None));
        let turn_counter = Arc::new(AtomicU64::new(1));
        let pending_prompts = Arc::new(parking_lot::Mutex::new(HashMap::new()));
        let pending_requests: PendingRequests = Arc::new(parking_lot::Mutex::new(HashMap::new()));
        let startup_error = Arc::new(parking_lot::Mutex::new(None));
        let materialized = Arc::new(AtomicBool::new(false));
        let client = Arc::new(Self {
            events_tx: events_tx.clone(),
            request_tx,
            thread_id: Arc::clone(&thread_slot),
            active_turn_id: Arc::clone(&active_turn_id),
            pending_prompts: Arc::clone(&pending_prompts),
            pending_requests: Arc::clone(&pending_requests),
            request_seq: AtomicU64::new(1),
            materialized: Arc::clone(&materialized),
            startup_error: Arc::clone(&startup_error),
            thread_options: thread_options.clone(),
        });
        let state = LoopState {
            events_tx: events_tx.clone(),
            thread_id: thread_slot,
            active_turn_id,
            turn_counter,
            pending_prompts,
            pending_requests,
            reply_tx: client.request_tx.clone(),
        };
        std::thread::Builder::new()
            .name("codex-ws".into())
            .spawn(move || {
                if let Err(message) = run_ws_loop(
                    ws_url,
                    state,
                    request_rx,
                    mode,
                    cwd,
                    thread_options,
                    materialized,
                ) {
                    *startup_error.lock() = Some(message.clone());
                    let _ = events_tx.send(AgentEvent::Error { message });
                }
            })
            .map_err(|e| AgentError::Connect(format!("spawn codex ws: {e}")))?;
        Ok(client)
    }

    /// The server-allocated thread id, once `thread/start` has answered.
    pub fn thread_id(&self) -> Option<String> {
        self.thread_id.lock().clone()
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

    /// Sends `turn/start`. The user's prompt is not echoed by Codex as a turn event, so
    /// the read loop emits a role=user `MessageDelta` + `MessageCompleted` when the
    /// `turn/start` response delivers the server turn id (the same id `turn/started` uses).
    pub fn send_turn_with_policy(
        &self,
        text: &str,
        approval_policy: Option<&str>,
    ) -> Result<(), AgentError> {
        let thread_id = self
            .thread_id()
            .ok_or_else(|| AgentError::Protocol("codex thread not ready".into()))?;
        let seq = self.request_seq.fetch_add(1, Ordering::SeqCst);
        let request_id = format!("turn-{seq}");
        let mut params = json!({
            "threadId": thread_id,
            "input": [{ "type": "text", "text": text }],
        });
        if let Some(policy) = approval_policy {
            params["approvalPolicy"] = json!(policy);
        } else if let Some(policy) = self.thread_options.approval_policy.clone() {
            params["approvalPolicy"] = policy;
        }
        if let Some(sandbox) = self.thread_options.sandbox_policy.as_ref() {
            // turn/start takes the tagged-object form, thread options hold the CLI string.
            params["sandboxPolicy"] = match sandbox.as_str() {
                Some("workspace-write") => json!({ "type": "workspaceWrite" }),
                Some("read-only") => json!({ "type": "readOnly" }),
                Some("danger-full-access") => json!({ "type": "dangerFullAccess" }),
                _ => sandbox.clone(),
            };
        }
        self.pending_prompts
            .lock()
            .insert(request_id.clone(), text.to_string());
        let sent = self.send_rpc(json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "turn/start",
            "params": params,
        }));
        if sent.is_err() {
            self.pending_prompts.lock().remove(&request_id);
        }
        sent
    }

    pub fn interrupt(&self) -> Result<(), AgentError> {
        let thread_id = self
            .thread_id()
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
        let (method, params) = self
            .pending_requests
            .lock()
            .remove(request_id)
            .unwrap_or_else(|| (String::new(), Value::Null));
        let result = approval_reply(&method, &params, decision)?;
        self.send_rpc(json!({
            "jsonrpc": "2.0",
            "id": rpc_id_from_approval_id(request_id),
            "result": result
        }))
    }
}

/// JSON-RPC error for a server request we do not implement.
fn unsupported_request_reply(request: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": request.get("id").cloned().unwrap_or(Value::Null),
        "error": { "code": -32601, "message": "not supported by Loomria" }
    })
}

/// The `result` that answers a pending server request. The reply shape depends on the method
/// (see docs/codex-protocol-notes.md); `decision` is the UI decision or an `answer:{...}` payload.
fn approval_reply(method: &str, params: &Value, decision: &str) -> Result<Value, AgentError> {
    if method == "item/tool/requestUserInput" {
        return question_reply(params, decision);
    }
    let allow = match decision {
        "allow_once" => Some(false),
        "allow_always" => Some(true),
        "deny" => None,
        other => {
            return Err(AgentError::Protocol(format!(
                "unsupported codex approval decision {other}"
            )));
        }
    };
    Ok(match method {
        "execCommandApproval" | "applyPatchApproval" => json!({
            "decision": match allow {
                Some(true) => "approved_for_session",
                Some(false) => "approved",
                None => "denied",
            }
        }),
        "item/permissions/requestApproval" => match allow {
            Some(always) => json!({
                "permissions": params.get("permissions").cloned().unwrap_or_else(|| json!({})),
                "scope": if always { "session" } else { "turn" },
            }),
            None => json!({ "permissions": {} }),
        },
        _ => json!({
            "decision": match allow {
                Some(true) => "acceptForSession",
                Some(false) => "accept",
                None => "decline",
            }
        }),
    })
}

/// Answers to `item/tool/requestUserInput`: the dock sends `answer:{<question text>: <answer>}`;
/// Codex wants `{answers: {<question id>: {answers: [<answer>]}}}`.
fn question_reply(params: &Value, decision: &str) -> Result<Value, AgentError> {
    let questions = params
        .get("questions")
        .and_then(|q| q.as_array())
        .cloned()
        .unwrap_or_default();
    let mut answers = serde_json::Map::new();
    if let Some(raw) = decision.strip_prefix(crate::protocol::claude_stream_json::ANSWER_PREFIX) {
        let given: serde_json::Map<String, Value> = serde_json::from_str::<Value>(raw)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .ok_or_else(|| AgentError::Protocol("question answers must be a JSON object".into()))?;
        for q in &questions {
            let (Some(id), Some(text)) = (
                q.get("id").and_then(|v| v.as_str()),
                q.get("question").and_then(|v| v.as_str()),
            ) else {
                continue;
            };
            if let Some(answer) = given.get(text).and_then(|v| v.as_str()) {
                answers.insert(id.to_string(), json!({ "answers": [answer] }));
            }
        }
    }
    // Declining (or an answer we could not match) sends empty answers so the turn carries on.
    Ok(json!({ "answers": answers }))
}

/// Codex numbers its server requests. The approval id is that id as a string, but a JSON-RPC
/// reply must echo the original type or the server ignores it, so integers go back as numbers.
fn rpc_id_from_approval_id(approval_id: &str) -> Value {
    match approval_id.parse::<i64>() {
        Ok(n) if n.to_string() == approval_id => json!(n),
        _ => json!(approval_id),
    }
}

fn run_ws_loop(
    ws_url: String,
    state: LoopState,
    request_rx: std::sync::mpsc::Receiver<Value>,
    mode: ThreadMode,
    cwd: String,
    thread_options: CodexThreadOptions,
    materialized: Arc<AtomicBool>,
) -> Result<(), String> {
    let (mut ws, _) = connect(&ws_url).map_err(|e| format!("codex ws connect: {e}"))?;
    set_read_timeout(&mut ws)?;

    // 1. initialize, and wait for the server to answer before anything else.
    send_json(
        &mut ws,
        json!({
            "jsonrpc": "2.0",
            "id": INIT_ID,
            "method": "initialize",
            "params": { "clientInfo": { "name": "loomria", "version": env!("CARGO_PKG_VERSION") } }
        }),
    )?;
    wait_for_response(&mut ws, &state, INIT_ID)?;

    // 2. `initialized` notification (required by the JSON-RPC handshake).
    send_json(&mut ws, json!({ "jsonrpc": "2.0", "method": "initialized" }))?;

    // 3. thread/start (server allocates the id) or thread/resume.
    //
    // ROOT CAUSE of "no rollout found" right after opening a pane (reproduced live on
    // 0.159): `thread/resume` of a thread whose rollout only holds `thread/name/set`
    // succeeds with `{threadId, cwd}` but FAILS with "no rollout found" as soon as it also
    // carries an `approvalPolicy` or `sandbox` override (deterministic, either key alone).
    // So resume never sends overrides; the policies travel on every `turn/start` instead
    // (see `send_turn_with_policy`). `thread/start` has no rollout to read, so it keeps them.
    let mut thread_params = json!({ "cwd": cwd });
    if matches!(mode, ThreadMode::Start { .. }) {
        if let Some(policy) = thread_options.approval_policy.clone() {
            thread_params["approvalPolicy"] = policy;
        }
        if let Some(sandbox) = thread_options.sandbox_policy.clone() {
            thread_params["sandbox"] = sandbox;
        }
    }
    let method = match &mode {
        ThreadMode::Start { .. } => "thread/start",
        ThreadMode::Resume(id) => {
            thread_params["threadId"] = json!(id);
            "thread/resume"
        }
    };
    send_json(
        &mut ws,
        json!({
            "jsonrpc": "2.0",
            "id": THREAD_ID,
            "method": method,
            "params": thread_params,
        }),
    )?;
    wait_for_response(&mut ws, &state, THREAD_ID)?;
    if state.thread_id.lock().is_none() {
        return Err(format!("codex {method} response carried no thread id"));
    }
    if let ThreadMode::Start { materialize: true } = mode {
        let id = state.thread_id.lock().clone().unwrap_or_default();
        send_json(
            &mut ws,
            json!({
                "jsonrpc": "2.0",
                "id": "thread-name",
                "method": "thread/name/set",
                "params": { "threadId": id, "name": "Loomria" },
            }),
        )?;
        wait_for_response(&mut ws, &state, "thread-name")?;
    }
    materialized.store(true, Ordering::SeqCst);

    loop {
        loop {
            match request_rx.try_recv() {
                Ok(value) => send_json(&mut ws, value)?,
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    // Client dropped: close the socket instead of leaking the thread.
                    let _ = ws.close(None);
                    return Ok(());
                }
            }
        }
        match ws.read() {
            Ok(Message::Text(text)) => handle_text(&state, &text),
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(ref e)) if is_read_timeout(e) => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(format!("read: {e}")),
        }
    }
    Err("codex ws closed".into())
}

/// Read until the response for `id` arrives; any other traffic is processed normally.
fn wait_for_response(ws: &mut Ws, state: &LoopState, id: &str) -> Result<(), String> {
    let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
    loop {
        if Instant::now() >= deadline {
            return Err(format!("codex handshake timed out waiting for {id}"));
        }
        match ws.read() {
            Ok(Message::Text(text)) => {
                if let Ok(value) = serde_json::from_str::<Value>(&text) {
                    if value.get("id").and_then(|v| v.as_str()) == Some(id)
                        && value.get("method").is_none()
                    {
                        if let Some(err) = value.get("error") {
                            return Err(format!("codex {id} failed: {err}"));
                        }
                        handle_value(state, &value);
                        return Ok(());
                    }
                }
                handle_text(state, &text);
            }
            Ok(Message::Close(_)) => return Err("codex ws closed during handshake".into()),
            Ok(_) => {}
            Err(tungstenite::Error::Io(ref e)) if is_read_timeout(e) => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(format!("read: {e}")),
        }
    }
}

fn handle_text(state: &LoopState, text: &str) {
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        handle_value(state, &value);
    }
}

fn handle_value(state: &LoopState, value: &Value) {
    // Responses: thread id (thread/start|resume) and turn id (turn/start).
    if value.get("method").is_none() {
        if let Some(id) = value
            .pointer("/result/thread/id")
            .and_then(|v| v.as_str())
            .or_else(|| value.pointer("/result/threadId").and_then(|v| v.as_str()))
        {
            *state.thread_id.lock() = Some(id.to_string());
        }
        if let Some(req_id) = value.get("id").and_then(|v| v.as_str()) {
            let pending = state.pending_prompts.lock().remove(req_id);
            if let Some(text) = pending {
                if let Some(err) = value.get("error") {
                    let _ = state.events_tx.send(AgentEvent::Error {
                        message: format!("codex turn/start failed: {err}"),
                    });
                } else if let Some(turn_id) =
                    value.pointer("/result/turn/id").and_then(|v| v.as_str())
                {
                    *state.active_turn_id.lock() = Some(turn_id.to_string());
                    emit_user_message(&state.events_tx, turn_id, &text);
                }
            }
        }
        return;
    }

    let turn = value
        .pointer("/params/turnId")
        .and_then(|v| v.as_str())
        .or_else(|| value.pointer("/params/turn/id").and_then(|v| v.as_str()));
    if let Some(turn) = turn {
        *state.active_turn_id.lock() = Some(turn.to_string());
    }
    let is_server_request = value.get("id").is_some()
        && value.get("result").is_none()
        && value.get("error").is_none();
    let events = if is_server_request {
        let events = map_codex_server_request(value, &state.turn_counter);
        let method = value.get("method").and_then(|m| m.as_str()).unwrap_or("");
        if events.is_empty() {
            // A request nobody answers hangs the turn: say "not supported" instead.
            tracing::warn!(method, "codex server request not supported; replying with an error");
            let _ = state.reply_tx.send(unsupported_request_reply(value));
        } else {
            state.pending_requests.lock().insert(
                server_request_key(value),
                (
                    method.to_string(),
                    value.get("params").cloned().unwrap_or(Value::Null),
                ),
            );
        }
        events
    } else {
        map_codex_notification(value, &state.turn_counter, &state.active_turn_id)
    };
    for event in events {
        let _ = state.events_tx.send(event);
    }
}

fn emit_user_message(tx: &broadcast::Sender<AgentEvent>, turn_id: &str, text: &str) {
    let message_id = format!("user-{turn_id}");
    let _ = tx.send(AgentEvent::MessageDelta {
        turn_id: turn_id.to_string(),
        message_id: message_id.clone(),
        role: MessageRole::User,
        text: text.to_string(),
        content_kind: MessageContentKind::Text,
        text_mode: MessageTextMode::Append,
    });
    let _ = tx.send(AgentEvent::MessageCompleted {
        turn_id: turn_id.to_string(),
        message_id,
        role: MessageRole::User,
        text: text.to_string(),
        content_kind: MessageContentKind::Text,
        duration_ms: None,
    });
}

fn tcp_from_maybe_tls(stream: &MaybeTlsStream<TcpStream>) -> Result<&TcpStream, String> {
    match stream {
        MaybeTlsStream::Plain(s) => Ok(s),
        MaybeTlsStream::Rustls(s) => Ok(s.get_ref()),
        _ => Err("unsupported MaybeTlsStream variant".into()),
    }
}

/// A 50ms read timeout surfaces as WouldBlock/TimedOut, or on Windows as ERROR_IO_PENDING (997).
fn is_read_timeout(e: &std::io::Error) -> bool {
    matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut)
        || e.raw_os_error() == Some(997)
}

fn set_read_timeout(ws: &mut Ws) -> Result<(), String> {
    tcp_from_maybe_tls(ws.get_ref())?
        .set_read_timeout(Some(Duration::from_millis(50)))
        .map_err(|e| format!("read timeout: {e}"))
}

fn send_json(ws: &mut Ws, value: Value) -> Result<(), String> {
    ws.send(Message::Text(value.to_string()))
        .map_err(|e| format!("send: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approval_reply_echoes_numeric_server_request_ids_as_numbers() {
        assert_eq!(rpc_id_from_approval_id("7"), json!(7));
        assert_eq!(rpc_id_from_approval_id("req-7"), json!("req-7"));
        assert_eq!(rpc_id_from_approval_id("07"), json!("07"));
    }

    #[test]
    fn start_thread_blocking_persists_thread_before_returning() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(parking_lot::Mutex::new(Vec::<String>::new()));
        let seen_srv = Arc::clone(&seen);
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            while let Ok(Message::Text(t)) = ws.read() {
                let v: Value = serde_json::from_str(&t).unwrap();
                let method = v["method"].as_str().unwrap_or("").to_string();
                seen_srv.lock().push(method.clone());
                let reply = match method.as_str() {
                    "initialize" => json!({"id": v["id"], "result": {}}),
                    "thread/start" => json!({"id": v["id"], "result": {"thread": {"id": "srv-thread"}}}),
                    "thread/name/set" => json!({"id": v["id"], "result": {}}),
                    _ => continue,
                };
                ws.send(Message::Text(reply.to_string())).unwrap();
            }
        });
        let (client, id) = CodexWsClient::start_thread_blocking(
            format!("ws://127.0.0.1:{port}"),
            ".".into(),
            CodexThreadOptions::default(),
            Duration::from_secs(10),
        )
        .unwrap();
        assert_eq!(id, "srv-thread");
        assert_eq!(
            *seen.lock(),
            vec!["initialize", "initialized", "thread/start", "thread/name/set"]
        );
        drop(client);
    }

    #[test]
    fn replies_match_each_request_kind() {
        let none = Value::Null;
        assert_eq!(
            approval_reply("item/commandExecution/requestApproval", &none, "allow_always").unwrap(),
            json!({"decision": "acceptForSession"})
        );
        assert_eq!(
            approval_reply("item/fileChange/requestApproval", &none, "deny").unwrap(),
            json!({"decision": "decline"})
        );
        assert_eq!(
            approval_reply("execCommandApproval", &none, "allow_once").unwrap(),
            json!({"decision": "approved"})
        );
        assert_eq!(
            approval_reply("applyPatchApproval", &none, "deny").unwrap(),
            json!({"decision": "denied"})
        );
        assert!(approval_reply("execCommandApproval", &none, "maybe").is_err());
    }

    #[test]
    fn permission_request_is_granted_by_echoing_what_was_asked() {
        let params = json!({"permissions": {"network": {"enabled": true}}, "reason": "needs net"});
        assert_eq!(
            approval_reply("item/permissions/requestApproval", &params, "allow_once").unwrap(),
            json!({"permissions": {"network": {"enabled": true}}, "scope": "turn"})
        );
        assert_eq!(
            approval_reply("item/permissions/requestApproval", &params, "allow_always").unwrap(),
            json!({"permissions": {"network": {"enabled": true}}, "scope": "session"})
        );
        assert_eq!(
            approval_reply("item/permissions/requestApproval", &params, "deny").unwrap(),
            json!({"permissions": {}})
        );
    }

    #[test]
    fn question_answers_are_keyed_by_question_id() {
        let params = json!({"questions": [
            {"id": "q1", "question": "Which color?", "header": "Color"},
            {"id": "q2", "question": "Name?", "header": "Name"}
        ]});
        let reply = approval_reply(
            "item/tool/requestUserInput",
            &params,
            r#"answer:{"Which color?":"Blue","Name?":"a, b"}"#,
        )
        .unwrap();
        assert_eq!(
            reply,
            json!({"answers": {"q1": {"answers": ["Blue"]}, "q2": {"answers": ["a, b"]}}})
        );
        // declining still answers, with nothing, so the turn is not left waiting
        assert_eq!(
            approval_reply("item/tool/requestUserInput", &params, "deny").unwrap(),
            json!({"answers": {}})
        );
    }

    #[test]
    fn unsupported_server_request_gets_a_method_not_found_error() {
        let reply = unsupported_request_reply(&json!({"id": 99, "method": "future/thing"}));
        assert_eq!(reply["id"], json!(99));
        assert_eq!(reply["error"]["code"], json!(-32601));
    }

    #[test]
    fn unknown_server_request_is_answered_over_the_socket() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (got_tx, got_rx) = std::sync::mpsc::channel::<Value>();
        std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            let mut asked = false;
            while let Ok(msg) = ws.read() {
                let Message::Text(t) = msg else { continue };
                let v: Value = serde_json::from_str(&t).unwrap();
                if v.get("method").is_none() {
                    let _ = got_tx.send(v);
                    break;
                }
                let reply = match v["method"].as_str().unwrap_or("") {
                    "initialize" => json!({"id": v["id"], "result": {}}),
                    "thread/start" => json!({"id": v["id"], "result": {"thread": {"id": "t"}}}),
                    "thread/name/set" => json!({"id": v["id"], "result": {}}),
                    _ => continue,
                };
                ws.send(Message::Text(reply.to_string())).unwrap();
                if v["method"] == "thread/name/set" && !asked {
                    asked = true;
                    ws.send(Message::Text(
                        json!({"id": 99, "method": "future/thing", "params": {}}).to_string(),
                    ))
                    .unwrap();
                }
            }
        });
        let (client, _) = CodexWsClient::start_thread_blocking(
            format!("ws://127.0.0.1:{port}"),
            ".".into(),
            CodexThreadOptions::default(),
            Duration::from_secs(10),
        )
        .unwrap();
        let reply = got_rx.recv_timeout(Duration::from_secs(10)).expect("error reply");
        assert_eq!(reply["id"], json!(99));
        assert_eq!(reply["error"]["code"], json!(-32601));
        drop(client);
    }
}
