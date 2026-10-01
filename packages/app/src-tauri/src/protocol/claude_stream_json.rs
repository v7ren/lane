//! Claude `--output-format stream-json` headless session (Shape 3).

use super::event_contract::is_claude_auth_failure_text;
use super::types::{
    AgentError, AgentEvent, ApprovalDecision, ApprovalKind, Capabilities, Endpoint, MessageContentKind,
    MessageRole, MessageTextMode, ProtocolAdapter, ProtocolSession, ToolStatus, TurnStatus,
};
use crate::agents::ProtocolKind;
use crate::opencode::event_map::next_turn;
use parking_lot::Mutex;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::thread;
use tokio::sync::broadcast;
use uuid::Uuid;

/// `request_id` of the `initialize` request sent on connect; its reply carries models and commands.
const INIT_REQUEST_ID: &str = "loomria-init";

/// Permission modes the GUI may switch to. `bypassPermissions` is deliberately not offered.
const SETTABLE_PERMISSION_MODES: [&str; 3] = ["default", "acceptEdits", "plan"];

pub struct ClaudeStreamJsonAdapter;

impl ProtocolAdapter for ClaudeStreamJsonAdapter {
    fn protocol(&self) -> ProtocolKind {
        ProtocolKind::ClaudeStreamJson
    }

    fn connect(&self, endpoint: Endpoint) -> Result<Box<dyn ProtocolSession>, AgentError> {
        let session_id = endpoint
            .session_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let cwd = endpoint.cwd.clone().unwrap_or_else(|| {
            std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into())
        });
        let (tx, _rx) = broadcast::channel(256);
        let turn_counter = Arc::new(AtomicU64::new(1));
        let claude_exe = crate::shell_env::resolve_claude_executable()
            .map_err(|e| AgentError::Connect(e))?;
        let permission_mode = std::env::var("LOOMRIA_CLAUDE_PERMISSION_MODE")
            .unwrap_or_else(|_| "default".into());
        let mut child = Command::new(&claude_exe);
        child
            .args([
                "-p",
                "--input-format",
                "stream-json",
                "--output-format",
                "stream-json",
                "--include-partial-messages",
                "--verbose",
                "--session-id",
                &session_id,
                "--permission-mode",
                &permission_mode,
                "--permission-prompt-tool",
                "stdio",
            ])
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        crate::shell_env::apply_path_to_command(&mut child);
        let mut child = child
            .spawn()
            .map_err(|e| AgentError::Connect(format!("spawn claude: {e}")))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentError::Connect("claude stdout missing".into()))?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AgentError::Connect("claude stdin missing".into()))?;
        let init = serde_json::json!({
            "type": "control_request",
            "request_id": INIT_REQUEST_ID,
            "request": { "subtype": "initialize" },
        });
        writeln!(stdin, "{init}")
            .and_then(|()| stdin.flush())
            .map_err(|e| AgentError::Connect(format!("claude initialize: {e}")))?;
        let stderr = child.stderr.take();

        let tx_reader = tx.clone();
        let turn_for_reader = Arc::clone(&turn_counter);
        let mapper = Arc::new(Mutex::new(ClaudeStreamMapper::default()));
        let mapper_reader = Arc::clone(&mapper);
        thread::Builder::new()
            .name("claude-stream-json".into())
            .spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    let mut map = mapper_reader.lock();
                    for event in map.push_line(&line, &turn_for_reader) {
                        let _ = tx_reader.send(event);
                    }
                }
                let ended = mapper_reader.lock().process_ended(&turn_for_reader);
                for event in ended {
                    let _ = tx_reader.send(event);
                }
            })
            .map_err(|e| AgentError::Connect(format!("spawn reader: {e}")))?;

        if let Some(stderr) = stderr {
            let tx_err = tx.clone();
            thread::Builder::new()
                .name("claude-stream-json-err".into())
                .spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines().map_while(Result::ok) {
                        if is_claude_auth_failure_text(&line) {
                            let _ = tx_err.send(AgentEvent::Error { message: line });
                        }
                    }
                })
                .ok();
        }

        Ok(Box::new(ClaudeStreamJsonSession {
            session_id,
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            events_tx: tx,
            turn_counter,
            mapper,
        }))
    }
}

/// Claude never echoes the user's prompt on stdout, so the transcript would have no
/// user turn. Emit `TurnStarted` followed by a role=user message (same `turn_id`) so
/// the view-model can render the prompt before the assistant reply.
pub fn emit_user_prompt_events(tx: &broadcast::Sender<AgentEvent>, turn_id: &str, text: &str) {
    let message_id = format!("user-{turn_id}-{}", Uuid::new_v4());
    let _ = tx.send(AgentEvent::TurnStarted {
        turn_id: turn_id.to_string(),
    });
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

struct ClaudeStreamJsonSession {
    session_id: String,
    stdin: Mutex<std::process::ChildStdin>,
    child: Mutex<Child>,
    events_tx: broadcast::Sender<AgentEvent>,
    turn_counter: Arc<AtomicU64>,
    mapper: Arc<Mutex<ClaudeStreamMapper>>,
}

impl ClaudeStreamJsonSession {
    fn write_line(&self, payload: &Value) -> Result<(), AgentError> {
        let mut stdin = self.stdin.lock();
        writeln!(stdin, "{payload}")
            .map_err(|e| AgentError::Protocol(format!("claude stdin: {e}")))?;
        stdin
            .flush()
            .map_err(|e| AgentError::Protocol(format!("claude stdin flush: {e}")))
    }
}

/// `control_response` answering a `can_use_tool` request. Allow echoes the tool input back
/// (Claude requires `updatedInput`); "always" also applies Claude's own permission suggestions.
/// Decision prefix carrying the user's answers (`answer:{"<question>":"<label>"}`) for a question request.
pub const ANSWER_PREFIX: &str = "answer:";

/// `control_response` answering an `AskUserQuestion` request: allow, with the answers filled in.
fn question_control_response(request_id: &str, request: &Value, answers: Value) -> Value {
    let mut input = request.get("input").cloned().unwrap_or_else(|| serde_json::json!({}));
    input["answers"] = answers;
    serde_json::json!({
        "type": "control_response",
        "response": {
            "subtype": "success",
            "request_id": request_id,
            "response": { "behavior": "allow", "updatedInput": input },
        },
    })
}

fn approval_control_response(request_id: &str, request: &Value, decision: ApprovalDecision) -> Value {
    let response = match decision {
        ApprovalDecision::Deny => serde_json::json!({
            "behavior": "deny",
            "message": "The user denied this action.",
        }),
        ApprovalDecision::AllowOnce | ApprovalDecision::AllowAlways => {
            let mut allow = serde_json::json!({
                "behavior": "allow",
                "updatedInput": request.get("input").cloned().unwrap_or(Value::Null),
            });
            if decision == ApprovalDecision::AllowAlways {
                if let Some(suggestions) = request.get("permission_suggestions") {
                    allow["updatedPermissions"] = suggestions.clone();
                }
            }
            allow
        }
    };
    serde_json::json!({
        "type": "control_response",
        "response": { "subtype": "success", "request_id": request_id, "response": response },
    })
}

impl ProtocolSession for ClaudeStreamJsonSession {
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
        self.mapper.lock().begin_turn();
        emit_user_prompt_events(&self.events_tx, &turn_id, &text);
        let payload = serde_json::json!({
            "type": "user",
            "message": { "role": "user", "content": text },
        });
        self.write_line(&payload)
    }

    fn respond_to_approval(&self, approval_id: &str, decision: &str) -> Result<(), AgentError> {
        let answers = decision.strip_prefix(ANSWER_PREFIX).map(|raw| {
            serde_json::from_str::<Value>(raw)
                .ok()
                .filter(Value::is_object)
                .ok_or_else(|| AgentError::Protocol("question answers must be a JSON object".into()))
        });
        let parsed = match &answers {
            Some(_) => ApprovalDecision::AllowOnce,
            None => ApprovalDecision::parse(decision).map_err(AgentError::Protocol)?,
        };
        let request = self
            .mapper
            .lock()
            .take_approval(approval_id)
            .ok_or_else(|| AgentError::Protocol(format!("unknown approval {approval_id}")))?;
        let payload = match answers {
            Some(answers) => question_control_response(approval_id, &request, answers?),
            None => approval_control_response(approval_id, &request, parsed),
        };
        self.write_line(&payload)?;
        let _ = self.events_tx.send(AgentEvent::ApprovalResolved {
            approval_id: approval_id.to_string(),
            decision: parsed,
        });
        Ok(())
    }

    fn cancel_turn(&self) -> Result<(), AgentError> {
        self.mapper.lock().request_interrupt();
        self.write_line(&serde_json::json!({
            "type": "control_request",
            "request_id": Uuid::new_v4().to_string(),
            "request": { "subtype": "interrupt" },
        }))
    }

    fn child_pid(&self) -> Option<u32> {
        Some(self.child.lock().id())
    }

    fn agent_info(&self) -> Option<Value> {
        self.mapper.lock().agent_info()
    }

    fn set_option(&self, key: &str, value: &str) -> Result<(), AgentError> {
        let request = match key {
            "model" => serde_json::json!({ "subtype": "set_model", "model": value }),
            "permission_mode" if SETTABLE_PERMISSION_MODES.contains(&value) => {
                serde_json::json!({ "subtype": "set_permission_mode", "mode": value })
            }
            "permission_mode" => {
                return Err(AgentError::Protocol(format!("unsupported permission mode {value}")))
            }
            other => return Err(AgentError::Unsupported(format!("unsupported option {other}"))),
        };
        self.write_line(&serde_json::json!({
            "type": "control_request",
            "request_id": Uuid::new_v4().to_string(),
            "request": request,
        }))?;
        self.mapper.lock().record_option(key, value);
        Ok(())
    }
}

impl Drop for ClaudeStreamJsonSession {
    fn drop(&mut self) {
        tracing::debug!(session_id = %self.session_id, "claude stream-json session ending");
        let _ = self.child.lock().kill();
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum BlockKind {
    Text,
    Thinking,
}

struct StreamBlock {
    msg: String,
    index: u64,
    kind: BlockKind,
    id: String,
    text: String,
    finalized: bool,
}

/// Maps Claude `--output-format stream-json` lines to `AgentEvent`s.
///
/// Shapes handled (verified against a live capture of claude 2.1.x, see
/// `tests/fixtures/claude_raw_turns.jsonl`):
/// - `stream_event` partial deltas (`--include-partial-messages`): `message_start`,
///   `content_block_start`, `content_block_delta` (`text_delta`, `thinking_delta`),
///   emitted as cumulative `Replace` deltas so hub coalescing cannot lose text.
/// - `assistant.message.content[]` blocks: `text` completes the streamed message (or is
///   emitted whole if nothing streamed), `thinking` is a reasoning message, `tool_use` starts a tool.
/// - `user.message.content[]` `tool_result` (with `is_error`) completes a tool.
/// - `result` (`is_error`, `subtype`, `total_cost_usd`, `usage`) ends the turn.
///
/// Everything else (`system`, `rate_limit_event` when allowed, unknown types) is dropped.
#[derive(Default)]
pub struct ClaudeStreamMapper {
    turn_finished: bool,
    seq: u64,
    current_msg: Option<String>,
    blocks: Vec<StreamBlock>,
    ordinals: HashMap<(String, BlockKindKey), usize>,
    started_tools: HashSet<String>,
    pending_approvals: HashMap<String, Value>,
    interrupt_requested: bool,
    agent_info: Option<Value>,
}

type BlockKindKey = u8;

fn kind_key(kind: BlockKind) -> BlockKindKey {
    match kind {
        BlockKind::Text => 0,
        BlockKind::Thinking => 1,
    }
}

impl ClaudeStreamMapper {
    pub fn agent_info(&self) -> Option<Value> {
        self.agent_info.clone()
    }

    /// Keep the reported info in step with a setting the user changed.
    pub fn record_option(&mut self, key: &str, value: &str) {
        let field = match key {
            "model" => "current_model",
            "permission_mode" => "current_permission_mode",
            _ => return,
        };
        if let Some(info) = self.agent_info.as_mut() {
            info[field] = Value::String(value.to_string());
        }
    }

    fn map_control_response(&mut self, value: &Value) {
        let response = value.get("response");
        if response.and_then(|r| r.get("request_id")).and_then(|v| v.as_str()) != Some(INIT_REQUEST_ID) {
            return;
        }
        if response.and_then(|r| r.get("subtype")).and_then(|v| v.as_str()) == Some("success") {
            self.agent_info = response.and_then(|r| r.get("response")).cloned();
        }
    }

    /// The user pressed Stop: Claude ends the turn with an error result that is not a failure.
    pub fn request_interrupt(&mut self) {
        self.interrupt_requested = true;
    }

    pub fn begin_turn(&mut self) {
        self.turn_finished = false;
        self.interrupt_requested = false;
        self.current_msg = None;
        self.blocks.clear();
        self.ordinals.clear();
        self.started_tools.clear();
    }

    /// Claude closed its output: surface it, and end the running turn so the chat is not left "working".
    pub fn process_ended(&mut self, turn_counter: &Arc<AtomicU64>) -> Vec<AgentEvent> {
        let message = "The claude process ended unexpectedly.".to_string();
        let mut out = vec![AgentEvent::Error {
            message: message.clone(),
        }];
        if !self.turn_finished {
            out.push(AgentEvent::TurnCompleted {
                turn_id: turn_counter.load(std::sync::atomic::Ordering::SeqCst).to_string(),
                status: TurnStatus::Error,
                error: Some(message),
            });
        }
        self.turn_finished = true;
        out
    }

    /// Remove and return the `can_use_tool` request stored for an approval id.
    pub fn take_approval(&mut self, approval_id: &str) -> Option<Value> {
        self.pending_approvals.remove(approval_id)
    }

    fn map_control_request(&mut self, value: &Value, out: &mut Vec<AgentEvent>) {
        let Some(request_id) = value.get("request_id").and_then(|v| v.as_str()) else {
            return;
        };
        let Some(request) = value.get("request") else {
            return;
        };
        if request.get("subtype").and_then(|v| v.as_str()) != Some("can_use_tool") {
            return;
        }
        let tool = request
            .get("display_name")
            .or_else(|| request.get("tool_name"))
            .and_then(|v| v.as_str())
            .unwrap_or("tool");
        let input = request.get("input");
        let detail = ["command", "file_path", "url", "pattern", "path"]
            .iter()
            .find_map(|key| input.and_then(|i| i.get(*key)).and_then(|v| v.as_str()))
            .map(str::to_string)
            .or_else(|| request.get("description").and_then(|v| v.as_str()).map(str::to_string))
            .unwrap_or_else(|| input.map(|i| i.to_string()).unwrap_or_default());
        if request.get("tool_name").and_then(|v| v.as_str()) == Some("AskUserQuestion") {
            let questions = input
                .and_then(|i| i.get("questions"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!([]));
            self.pending_approvals
                .insert(request_id.to_string(), request.clone());
            out.push(AgentEvent::ApprovalRequested {
                approval_id: request_id.to_string(),
                title: "Question".to_string(),
                detail: questions.to_string(),
                kind: ApprovalKind::Question,
                options: vec![ApprovalDecision::AllowOnce, ApprovalDecision::Deny],
            });
            return;
        }
        if request.get("tool_name").and_then(|v| v.as_str()) == Some("ExitPlanMode") {
            let plan = input
                .and_then(|i| i.get("plan"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            self.pending_approvals
                .insert(request_id.to_string(), request.clone());
            out.push(AgentEvent::ApprovalRequested {
                approval_id: request_id.to_string(),
                title: "Plan".to_string(),
                detail: plan,
                kind: ApprovalKind::Plan,
                options: vec![ApprovalDecision::AllowOnce, ApprovalDecision::Deny],
            });
            return;
        }
        let kind = match request.get("tool_name").and_then(|v| v.as_str()) {
            Some("Bash") | Some("PowerShell") => ApprovalKind::Command,
            Some("Edit") | Some("Write") | Some("MultiEdit") | Some("NotebookEdit") => ApprovalKind::Edit,
            _ => ApprovalKind::Other,
        };
        self.pending_approvals
            .insert(request_id.to_string(), request.clone());
        out.push(AgentEvent::ApprovalRequested {
            approval_id: request_id.to_string(),
            title: format!("Allow {tool}?"),
            detail,
            kind,
            options: vec![
                ApprovalDecision::AllowOnce,
                ApprovalDecision::AllowAlways,
                ApprovalDecision::Deny,
            ],
        });
    }

    fn next_seq(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }

    fn block_id(&mut self, msg: &str, kind: BlockKind) -> String {
        let ord = self
            .ordinals
            .entry((msg.to_string(), kind_key(kind)))
            .or_insert(0);
        let n = *ord;
        *ord += 1;
        match (kind, n) {
            (BlockKind::Text, 0) => msg.to_string(),
            (BlockKind::Text, n) => format!("{msg}:{n}"),
            (BlockKind::Thinking, n) => format!("{msg}:thinking:{n}"),
        }
    }

    fn message_key(&mut self, value: &Value) -> String {
        if let Some(id) = value
            .pointer("/message/id")
            .and_then(|v| v.as_str())
            .or_else(|| value.get("uuid").and_then(|v| v.as_str()))
        {
            return id.to_string();
        }
        let n = self.next_seq();
        format!("assistant-{n}")
    }

    pub fn push_line(
        &mut self,
        line: &str,
        turn_counter: &Arc<AtomicU64>,
    ) -> Vec<AgentEvent> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        if value.get("type").and_then(|t| t.as_str()) == Some("control_response") {
            self.map_control_response(&value);
            return Vec::new();
        }
        if self.turn_finished {
            return Vec::new();
        }
        let turn_id = turn_counter.load(std::sync::atomic::Ordering::SeqCst).to_string();
        let mut out = Vec::new();
        match value.get("type").and_then(|t| t.as_str()) {
            Some("stream_event") => self.map_stream_event(&value, &turn_id, &mut out),
            Some("assistant") | Some("message") => {
                self.map_assistant(&value, &turn_id, &mut out);
            }
            Some("user") => {
                if let Some(blocks) = value.pointer("/message/content").and_then(|c| c.as_array()) {
                    for block in blocks {
                        if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                            out.push(tool_result_event(block, &turn_id));
                        }
                    }
                }
            }
            Some("control_request") => self.map_control_request(&value, &mut out),
            Some("tool_use") => {
                out.push(self.tool_started(&value, &turn_id));
            }
            Some("tool_result") => {
                out.push(tool_result_event(&value, &turn_id));
            }
            Some("rate_limit_event") => {
                let info = value.get("rate_limit_info");
                let status = info
                    .and_then(|i| i.get("status"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("allowed");
                if status == "rejected" || status == "blocked" {
                    let resets = info
                        .and_then(|i| i.get("resetsAt"))
                        .and_then(|v| v.as_i64())
                        .map(|s| s * 1000);
                    out.push(AgentEvent::RateLimited {
                        retry_at_ms: resets,
                        message: format!("claude rate limit: {status}"),
                    });
                }
            }
            Some("result") => self.map_result(&value, &turn_id, &mut out),
            Some("error") => {
                let message = value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("claude error")
                    .to_string();
                out.push(AgentEvent::Error {
                    message: message.clone(),
                });
                out.push(AgentEvent::TurnCompleted {
                    turn_id,
                    status: TurnStatus::Error,
                    error: Some(message),
                });
                self.turn_finished = true;
            }
            _ => {}
        }
        out
    }

    fn map_stream_event(&mut self, value: &Value, turn_id: &str, out: &mut Vec<AgentEvent>) {
        let Some(event) = value.get("event") else {
            return;
        };
        match event.get("type").and_then(|t| t.as_str()) {
            Some("message_start") => {
                self.current_msg = event
                    .pointer("/message/id")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
            Some("content_block_start") => {
                let Some(msg) = self.current_msg.clone() else {
                    return;
                };
                let kind = match event.pointer("/content_block/type").and_then(|t| t.as_str()) {
                    Some("text") => BlockKind::Text,
                    Some("thinking") => BlockKind::Thinking,
                    _ => return,
                };
                let index = event.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                let id = self.block_id(&msg, kind);
                self.blocks.push(StreamBlock {
                    msg,
                    index,
                    kind,
                    id,
                    text: String::new(),
                    finalized: false,
                });
            }
            Some("content_block_delta") => {
                let Some(msg) = self.current_msg.clone() else {
                    return;
                };
                let index = event.get("index").and_then(|i| i.as_u64()).unwrap_or(0);
                let (kind, chunk) = match event.pointer("/delta/type").and_then(|t| t.as_str()) {
                    Some("text_delta") => (
                        BlockKind::Text,
                        event.pointer("/delta/text").and_then(|t| t.as_str()),
                    ),
                    Some("thinking_delta") => (
                        BlockKind::Thinking,
                        event.pointer("/delta/thinking").and_then(|t| t.as_str()),
                    ),
                    _ => return,
                };
                let Some(chunk) = chunk else {
                    return;
                };
                let Some(block) = self
                    .blocks
                    .iter_mut()
                    .rev()
                    .find(|b| b.msg == msg && b.index == index && b.kind == kind && !b.finalized)
                else {
                    return;
                };
                block.text.push_str(chunk);
                out.push(delta_event(turn_id, &block.id, kind, block.text.clone()));
            }
            _ => {}
        }
    }

    fn map_assistant(&mut self, value: &Value, turn_id: &str, out: &mut Vec<AgentEvent>) {
        let msg = self.message_key(value);
        let mut pieces: Vec<(BlockKind, String)> = Vec::new();
        let mut tools: Vec<&Value> = Vec::new();
        match value.pointer("/message/content") {
            Some(Value::Array(blocks)) => {
                for block in blocks {
                    match block.get("type").and_then(|t| t.as_str()) {
                        Some("text") => {
                            if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                                pieces.push((BlockKind::Text, t.to_string()));
                            }
                        }
                        Some("thinking") => {
                            if let Some(t) = block.get("thinking").and_then(|t| t.as_str()) {
                                pieces.push((BlockKind::Thinking, t.to_string()));
                            }
                        }
                        Some("tool_use") => tools.push(block),
                        _ => {}
                    }
                }
            }
            _ => {
                if let Some(t) = value
                    .pointer("/message/content")
                    .and_then(|t| t.as_str())
                    .or_else(|| value.get("text").and_then(|t| t.as_str()))
                {
                    pieces.push((BlockKind::Text, t.to_string()));
                }
            }
        }

        for (kind, text) in pieces {
            if kind == BlockKind::Text && is_claude_auth_failure_text(&text) {
                out.push(AgentEvent::Error {
                    message: text.clone(),
                });
                out.push(AgentEvent::TurnCompleted {
                    turn_id: turn_id.to_string(),
                    status: TurnStatus::Error,
                    error: Some(text),
                });
                self.turn_finished = true;
                return;
            }
            if text.is_empty() {
                continue;
            }
            let streamed = self
                .blocks
                .iter_mut()
                .find(|b| b.msg == msg && b.kind == kind && !b.finalized);
            let id = match streamed {
                Some(block) => {
                    block.finalized = true;
                    block.id.clone()
                }
                None => {
                    let id = self.block_id(&msg, kind);
                    out.push(delta_event(turn_id, &id, kind, text.clone()));
                    id
                }
            };
            out.push(AgentEvent::MessageCompleted {
                turn_id: turn_id.to_string(),
                message_id: id,
                role: MessageRole::Assistant,
                text,
                content_kind: content_kind(kind),
                duration_ms: None,
            });
        }
        for tool in tools {
            let ev = self.tool_started(tool, turn_id);
            out.push(ev);
        }
    }

    fn tool_started(&mut self, block: &Value, turn_id: &str) -> AgentEvent {
        let tool_id = block
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("tool")
            .to_string();
        self.started_tools.insert(tool_id.clone());
        AgentEvent::ToolStarted {
            turn_id: turn_id.to_string(),
            tool_id,
            name: block
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("tool")
                .to_string(),
            input_summary: block
                .get("input")
                .map(|v| v.to_string())
                .unwrap_or_default(),
            tool_state: None,
            title: None,
        }
    }

    fn map_result(&mut self, value: &Value, turn_id: &str, out: &mut Vec<AgentEvent>) {
        let subtype = value.get("subtype").and_then(|s| s.as_str()).unwrap_or("");
        let is_error = value.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false)
            || subtype.starts_with("error");
        let cost = value.get("total_cost_usd").and_then(|v| v.as_f64());
        let usage = value.get("usage");
        if usage.is_some() || cost.is_some() {
            out.push(AgentEvent::Usage {
                input_tokens: usage.and_then(|u| u.get("input_tokens")).and_then(|v| v.as_u64()),
                output_tokens: usage.and_then(|u| u.get("output_tokens")).and_then(|v| v.as_u64()),
                cost_usd: cost,
            });
        }
        if is_error && self.interrupt_requested && subtype == "error_during_execution" {
            out.push(AgentEvent::TurnCompleted {
                turn_id: turn_id.to_string(),
                status: TurnStatus::Cancelled,
                error: None,
            });
        } else if is_error {
            let message = value
                .get("result")
                .and_then(|r| r.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| {
                    if subtype.is_empty() {
                        "claude turn failed".to_string()
                    } else {
                        format!("claude turn failed: {subtype}")
                    }
                });
            out.push(AgentEvent::Error {
                message: message.clone(),
            });
            out.push(AgentEvent::TurnCompleted {
                turn_id: turn_id.to_string(),
                status: TurnStatus::Error,
                error: Some(message),
            });
        } else {
            out.push(AgentEvent::TurnCompleted {
                turn_id: turn_id.to_string(),
                status: TurnStatus::Ok,
                error: None,
            });
        }
        self.turn_finished = true;
    }
}

fn content_kind(kind: BlockKind) -> MessageContentKind {
    match kind {
        BlockKind::Text => MessageContentKind::Text,
        BlockKind::Thinking => MessageContentKind::Reasoning,
    }
}

fn delta_event(turn_id: &str, message_id: &str, kind: BlockKind, text: String) -> AgentEvent {
    AgentEvent::MessageDelta {
        turn_id: turn_id.to_string(),
        message_id: message_id.to_string(),
        role: MessageRole::Assistant,
        text,
        content_kind: content_kind(kind),
        text_mode: MessageTextMode::Replace,
    }
}

fn tool_result_event(block: &Value, turn_id: &str) -> AgentEvent {
    let is_error = block.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false);
    let output_summary = match block.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    AgentEvent::ToolCompleted {
        turn_id: turn_id.to_string(),
        tool_id: block
            .get("tool_use_id")
            .and_then(|v| v.as_str())
            .unwrap_or("tool")
            .to_string(),
        status: if is_error { ToolStatus::Error } else { ToolStatus::Ok },
        output_summary,
        tool_state: None,
        title: None,
    }
}

pub fn adapter() -> Arc<dyn ProtocolAdapter> {
    Arc::new(ClaudeStreamJsonAdapter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;

    #[test]
    fn result_emits_usage_then_turn_completed_after_message_completed() {
        let counter = Arc::new(AtomicU64::new(1));
        let mut mapper = ClaudeStreamMapper::default();
        let mut events = mapper.push_line(
            r#"{"type":"assistant","uuid":"m1","message":{"content":[{"type":"text","text":"ok"}]}}"#,
            &counter,
        );
        events.extend(mapper.push_line(
            r#"{"type":"result","usage":{"input_tokens":1,"output_tokens":2}}"#,
            &counter,
        ));
        let types: Vec<&str> = events
            .iter()
            .map(|e| match e {
                AgentEvent::MessageDelta { .. } => "message_delta",
                AgentEvent::MessageCompleted { .. } => "message_completed",
                AgentEvent::Usage { .. } => "usage",
                AgentEvent::TurnCompleted { .. } => "turn_completed",
                _ => "other",
            })
            .collect();
        assert_eq!(
            types,
            vec!["message_delta", "message_completed", "usage", "turn_completed"]
        );
    }

    #[test]
    fn auth_text_becomes_error_not_assistant() {
        let counter = Arc::new(AtomicU64::new(1));
        let mut mapper = ClaudeStreamMapper::default();
        let events = mapper.push_line(
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Failed to authenticate: OAuth session expired"}]}}"#,
            &counter,
        );
        assert!(matches!(events.first(), Some(AgentEvent::Error { .. })));
    }

    #[test]
    fn thinking_block_is_reasoning_and_unknown_lines_are_dropped() {
        let counter = Arc::new(AtomicU64::new(1));
        let mut mapper = ClaudeStreamMapper::default();
        let events = mapper.push_line(
            r#"{"type":"assistant","message":{"id":"msg_1","content":[{"type":"thinking","thinking":"hmm"}]}}"#,
            &counter,
        );
        assert!(matches!(
            events.first(),
            Some(AgentEvent::MessageDelta {
                content_kind: MessageContentKind::Reasoning,
                ..
            })
        ));
        assert!(mapper.push_line(r#"{"type":"mystery"}"#, &counter).is_empty());
        assert!(mapper.push_line("not json", &counter).is_empty());
    }

    const CAN_USE_TOOL: &str = r#"{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash","input":{"command":"echo hi > probe.txt"},"permission_suggestions":[{"type":"addRules","behavior":"allow"}]}}"#;

    #[test]
    fn can_use_tool_becomes_an_approval_request_and_is_remembered() {
        let counter = Arc::new(AtomicU64::new(1));
        let mut mapper = ClaudeStreamMapper::default();
        let events = mapper.push_line(CAN_USE_TOOL, &counter);
        match events.as_slice() {
            [AgentEvent::ApprovalRequested { approval_id, title, detail, kind, options }] => {
                assert_eq!(approval_id, "req-1");
                assert_eq!(title, "Allow Bash?");
                assert_eq!(detail, "echo hi > probe.txt");
                assert_eq!(*kind, ApprovalKind::Command);
                assert_eq!(options.len(), 3);
            }
            other => panic!("unexpected events: {other:?}"),
        }
        assert!(mapper.take_approval("req-1").is_some());
        assert!(mapper.take_approval("req-1").is_none());
    }

    #[test]
    fn ask_user_question_becomes_a_question_and_answers_fill_updated_input() {
        let line = r#"{"type":"control_request","request_id":"q-1","request":{"subtype":"can_use_tool","tool_name":"AskUserQuestion","input":{"questions":[{"question":"Which color do you pick?","header":"Color","options":[{"label":"Red","description":"Pick red"}],"multiSelect":false}]}}}"#;
        let counter = Arc::new(AtomicU64::new(1));
        let mut mapper = ClaudeStreamMapper::default();
        let events = mapper.push_line(line, &counter);
        let detail = match events.as_slice() {
            [AgentEvent::ApprovalRequested { kind: ApprovalKind::Question, detail, .. }] => detail.clone(),
            other => panic!("unexpected events: {other:?}"),
        };
        assert!(detail.contains("Which color do you pick?"));
        let request = mapper.take_approval("q-1").unwrap();
        let reply = question_control_response("q-1", &request, serde_json::json!({"Which color do you pick?": "Red"}));
        let allow = &reply["response"]["response"];
        assert_eq!(allow["behavior"], "allow");
        assert_eq!(allow["updatedInput"]["answers"]["Which color do you pick?"], "Red");
        assert!(allow["updatedInput"]["questions"].is_array());
    }

    #[test]
    fn process_exit_reports_an_error_and_ends_the_running_turn_once() {
        let counter = Arc::new(AtomicU64::new(2));
        let mut mapper = ClaudeStreamMapper::default();
        let events = mapper.process_ended(&counter);
        assert!(matches!(events[0], AgentEvent::Error { .. }));
        assert!(matches!(
            &events[1],
            AgentEvent::TurnCompleted { turn_id, status: TurnStatus::Error, .. } if turn_id == "2"
        ));
        assert_eq!(mapper.process_ended(&counter).len(), 1);
    }

    #[test]
    fn a_stopped_turn_is_cancelled_not_an_error() {
        let counter = Arc::new(AtomicU64::new(1));
        let mut mapper = ClaudeStreamMapper::default();
        mapper.begin_turn();
        mapper.request_interrupt();
        let events = mapper.push_line(
            r#"{"type":"result","subtype":"error_during_execution","is_error":true}"#,
            &counter,
        );
        assert!(matches!(
            events.as_slice(),
            [AgentEvent::TurnCompleted { status: TurnStatus::Cancelled, error: None, .. }]
        ));
        let mut failed = ClaudeStreamMapper::default();
        failed.begin_turn();
        let events = failed.push_line(
            r#"{"type":"result","subtype":"error_during_execution","is_error":true}"#,
            &counter,
        );
        assert!(events.iter().any(|e| matches!(e, AgentEvent::Error { .. })));
    }

    #[test]
    fn initialize_reply_is_kept_as_agent_info_and_options_update_it() {
        let counter = Arc::new(AtomicU64::new(1));
        let mut mapper = ClaudeStreamMapper::default();
        assert!(mapper.agent_info().is_none());
        let reply = r#"{"type":"control_response","response":{"subtype":"success","request_id":"loomria-init","response":{"models":[{"value":"opus"}],"commands":[{"name":"design"}],"current_permission_mode":"default"}}}"#;
        assert!(mapper.push_line(reply, &counter).is_empty());
        let info = mapper.agent_info().unwrap();
        assert_eq!(info["models"][0]["value"], "opus");
        mapper.record_option("permission_mode", "plan");
        mapper.record_option("model", "opus");
        let info = mapper.agent_info().unwrap();
        assert_eq!(info["current_permission_mode"], "plan");
        assert_eq!(info["current_model"], "opus");
        let other = r#"{"type":"control_response","response":{"subtype":"success","request_id":"other","response":{"x":1}}}"#;
        mapper.push_line(other, &counter);
        assert_eq!(mapper.agent_info().unwrap()["models"][0]["value"], "opus");
    }

    #[test]
    fn exit_plan_mode_becomes_a_plan_approval_carrying_the_markdown() {
        let line = r##"{"type":"control_request","request_id":"p-1","request":{"subtype":"can_use_tool","tool_name":"ExitPlanMode","input":{"plan":"# Plan\n1. Do it","planFilePath":"x.md"}}}"##;
        let counter = Arc::new(AtomicU64::new(1));
        let mut mapper = ClaudeStreamMapper::default();
        match mapper.push_line(line, &counter).as_slice() {
            [AgentEvent::ApprovalRequested { kind: ApprovalKind::Plan, title, detail, options, .. }] => {
                assert_eq!(title, "Plan");
                assert!(detail.starts_with("# Plan"));
                assert_eq!(options.len(), 2);
            }
            other => panic!("unexpected events: {other:?}"),
        }
        let request = mapper.take_approval("p-1").unwrap();
        let allow = approval_control_response("p-1", &request, ApprovalDecision::AllowOnce);
        assert_eq!(allow["response"]["response"]["updatedInput"]["planFilePath"], "x.md");
    }

    #[test]
    fn approval_replies_match_claude_control_protocol() {
        let request: Value = serde_json::from_str::<Value>(CAN_USE_TOOL).unwrap()["request"].clone();
        let once = approval_control_response("req-1", &request, ApprovalDecision::AllowOnce);
        assert_eq!(once["type"], "control_response");
        assert_eq!(once["response"]["request_id"], "req-1");
        assert_eq!(once["response"]["response"]["behavior"], "allow");
        assert_eq!(once["response"]["response"]["updatedInput"]["command"], "echo hi > probe.txt");
        assert!(once["response"]["response"].get("updatedPermissions").is_none());
        let always = approval_control_response("req-1", &request, ApprovalDecision::AllowAlways);
        assert!(always["response"]["response"]["updatedPermissions"].is_array());
        let deny = approval_control_response("req-1", &request, ApprovalDecision::Deny);
        assert_eq!(deny["response"]["response"]["behavior"], "deny");
    }
}
