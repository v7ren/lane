//! Claude `--output-format stream-json` headless session (Shape 3).

use super::event_contract::is_claude_auth_failure_text;
use super::types::{
    AgentError, AgentEvent, Capabilities, Endpoint, MessageContentKind, MessageRole,
    MessageTextMode, ProtocolAdapter, ProtocolSession, ToolStatus, TurnStatus,
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
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AgentError::Connect("claude stdin missing".into()))?;
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

impl ProtocolSession for ClaudeStreamJsonSession {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            chat: true,
            send_prompt: true,
            approvals: false,
            cancel: false,
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
        let mut stdin = self.stdin.lock();
        writeln!(stdin, "{}", payload.to_string())
            .map_err(|e| AgentError::Protocol(format!("claude stdin: {e}")))?;
        stdin
            .flush()
            .map_err(|e| AgentError::Protocol(format!("claude stdin flush: {e}")))?;
        Ok(())
    }

    fn respond_to_approval(&self, _: &str, _: &str) -> Result<(), AgentError> {
        Err(AgentError::Unsupported(
            "claude headless stream-json does not surface interactive approvals".into(),
        ))
    }

    fn cancel_turn(&self) -> Result<(), AgentError> {
        Err(AgentError::Unsupported(
            "unsupported: cancel for claude stream-json".into(),
        ))
    }

    fn child_pid(&self) -> Option<u32> {
        Some(self.child.lock().id())
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
}

type BlockKindKey = u8;

fn kind_key(kind: BlockKind) -> BlockKindKey {
    match kind {
        BlockKind::Text => 0,
        BlockKind::Thinking => 1,
    }
}

impl ClaudeStreamMapper {
    pub fn begin_turn(&mut self) {
        self.turn_finished = false;
        self.current_msg = None;
        self.blocks.clear();
        self.ordinals.clear();
        self.started_tools.clear();
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
        if is_error {
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
}
