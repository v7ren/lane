//! Claude `--output-format stream-json` headless session (Shape 3).

use super::types::{
    AgentError, AgentEvent, Capabilities, Endpoint, ProtocolAdapter, ProtocolSession, MessageRole,
    TurnStatus, ToolStatus,
};
use crate::agents::ProtocolKind;
use crate::opencode::event_map::next_turn;
use parking_lot::Mutex;
use serde_json::Value;
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
        let cwd = endpoint
            .cwd
            .clone()
            .unwrap_or_else(|| std::env::temp_dir().to_string_lossy().to_string());
        let (tx, _rx) = broadcast::channel(256);
        let turn_counter = Arc::new(AtomicU64::new(1));
        let claude_exe = crate::shell_env::resolve_claude_executable()
            .map_err(|e| AgentError::Connect(e))?;
        let permission_mode = std::env::var("LOOMRIA_CLAUDE_PERMISSION_MODE")
            .unwrap_or_else(|_| "default".into());
        let mut child = Command::new(&claude_exe)
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
            .stderr(Stdio::null())
            .env("PATH", crate::shell_env::path_for_spawn())
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

        let tx_reader = tx.clone();
        let turn_for_reader = Arc::clone(&turn_counter);
        thread::Builder::new()
            .name("claude-stream-json".into())
            .spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    for event in map_claude_line(&line, &turn_for_reader) {
                        let _ = tx_reader.send(event);
                    }
                }
            })
            .map_err(|e| AgentError::Connect(format!("spawn reader: {e}")))?;

        Ok(Box::new(ClaudeStreamJsonSession {
            session_id,
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            events_tx: tx,
            turn_counter,
        }))
    }
}

struct ClaudeStreamJsonSession {
    session_id: String,
    stdin: Mutex<std::process::ChildStdin>,
    child: Mutex<Child>,
    events_tx: broadcast::Sender<AgentEvent>,
    turn_counter: Arc<AtomicU64>,
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
        let _ = self.events_tx.send(AgentEvent::TurnStarted {
            turn_id: turn_id.clone(),
        });
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

fn map_claude_line(line: &str, turn_counter: &Arc<AtomicU64>) -> Vec<AgentEvent> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    let turn_id = turn_counter.load(std::sync::atomic::Ordering::SeqCst).to_string();
    let mut out = Vec::new();
    match value.get("type").and_then(|t| t.as_str()) {
        Some("assistant") | Some("message") => {
            if let Some(text) = value
                .pointer("/message/content/0/text")
                .and_then(|t| t.as_str())
                .or_else(|| value.get("text").and_then(|t| t.as_str()))
            {
                let message_id = value
                    .get("uuid")
                    .and_then(|v| v.as_str())
                    .unwrap_or("assistant")
                    .to_string();
                out.push(AgentEvent::MessageDelta {
                    turn_id: turn_id.clone(),
                    message_id,
                    role: MessageRole::Assistant,
                    text: text.to_string(),
                });
            }
        }
        Some("tool_use") => {
            out.push(AgentEvent::ToolStarted {
                turn_id: turn_id.clone(),
                tool_id: value
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool")
                    .to_string(),
                name: value
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool")
                    .to_string(),
                input_summary: value
                    .get("input")
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
            });
        }
        Some("tool_result") => {
            out.push(AgentEvent::ToolCompleted {
                turn_id: turn_id.clone(),
                tool_id: value
                    .get("tool_use_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("tool")
                    .to_string(),
                status: ToolStatus::Ok,
                output_summary: value
                    .get("content")
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
            });
        }
        Some("result") => {
            out.push(AgentEvent::TurnCompleted {
                turn_id,
                status: TurnStatus::Ok,
                error: None,
            });
            if let Some(usage) = value.get("usage") {
                out.push(AgentEvent::Usage {
                    input_tokens: usage.get("input_tokens").and_then(|v| v.as_u64()),
                    output_tokens: usage.get("output_tokens").and_then(|v| v.as_u64()),
                    cost_usd: None,
                });
            }
        }
        Some("error") => {
            out.push(AgentEvent::Error {
                message: value
                    .get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("claude error")
                    .to_string(),
            });
        }
        _ => {}
    }
    out
}

pub fn adapter() -> Arc<dyn ProtocolAdapter> {
    Arc::new(ClaudeStreamJsonAdapter)
}
