//! Reads Claude's own session files (`~/.claude/projects/<encoded cwd>/<session id>.jsonl`)
//! and turns them into `AgentEvent`s, so a resumed or past chat shows its full transcript.
//!
//! Only `user` and `assistant` records matter; everything else (attachments, snapshots,
//! queue operations, cost state, ...) is ignored. Sidechain (subagent) and meta records are
//! skipped too.

use crate::protocol::{
    AgentEvent, MessageContentKind, MessageRole, MessageTextMode, PlanItem, PlanStatus, ToolStatus, TurnStatus,
};
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Claude names the project folder after the cwd with every non-alphanumeric char as `-`.
pub fn encode_cwd(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

fn projects_root() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".claude").join("projects"))
}

pub fn project_dir(cwd: &str) -> Option<PathBuf> {
    Some(projects_root()?.join(encode_cwd(cwd)))
}

pub fn session_path(cwd: &str, session_id: &str) -> Option<PathBuf> {
    // Session ids are uuids; refuse anything that could escape the project folder.
    if session_id.is_empty()
        || !session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return None;
    }
    Some(project_dir(cwd)?.join(format!("{session_id}.jsonl")))
}

pub fn session_exists(cwd: &str, session_id: &str) -> bool {
    session_path(cwd, session_id).is_some_and(|p| p.is_file())
}

/// Turns session-file lines into events. Feed lines in order with `push_line`; call
/// `finish` for a finished history so a turn left open (interrupted, crashed) is closed.
#[derive(Default)]
pub struct SessionReplay {
    turn: u64,
    turn_open: bool,
}

impl SessionReplay {
    /// Turns replayed so far; a live chat resumed from this history continues at `turns() + 1`.
    pub fn turns(&self) -> u64 {
        self.turn
    }

    pub fn push_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        if value.get("isSidechain").and_then(Value::as_bool) == Some(true)
            || value.get("isMeta").and_then(Value::as_bool) == Some(true)
        {
            return Vec::new();
        }
        let uuid = value.get("uuid").and_then(Value::as_str).unwrap_or("");
        let mut out = Vec::new();
        match value.get("type").and_then(Value::as_str) {
            Some("user") => self.map_user(&value, uuid, &mut out),
            Some("assistant") => self.map_assistant(&value, uuid, &mut out),
            _ => {}
        }
        out
    }

    pub fn finish(&mut self) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        self.close_turn(TurnStatus::Ok, &mut out);
        out
    }

    fn turn_id(&self) -> String {
        self.turn.to_string()
    }

    fn close_turn(&mut self, status: TurnStatus, out: &mut Vec<AgentEvent>) {
        if self.turn_open {
            out.push(AgentEvent::TurnCompleted {
                turn_id: self.turn_id(),
                status,
                error: None,
            });
            self.turn_open = false;
        }
    }

    fn open_turn(&mut self, out: &mut Vec<AgentEvent>) {
        if !self.turn_open {
            self.turn += 1;
            self.turn_open = true;
            out.push(AgentEvent::TurnStarted {
                turn_id: self.turn_id(),
            });
        }
    }

    fn map_user(&mut self, value: &Value, uuid: &str, out: &mut Vec<AgentEvent>) {
        let content = value.pointer("/message/content");
        let mut prompt = String::new();
        match content {
            Some(Value::String(s)) => prompt = s.clone(),
            Some(Value::Array(blocks)) => {
                for block in blocks {
                    match block.get("type").and_then(Value::as_str) {
                        Some("tool_result") => {
                            self.open_turn(out);
                            out.push(tool_result(block, &self.turn_id()));
                        }
                        Some("text") => {
                            if let Some(t) = block.get("text").and_then(Value::as_str) {
                                if !prompt.is_empty() {
                                    prompt.push('\n');
                                }
                                prompt.push_str(t);
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        let prompt = prompt.trim();
        if prompt.is_empty() {
            return;
        }
        if prompt == "[Request interrupted by user]"
            || prompt == "[Request interrupted by user for tool use]"
        {
            self.close_turn(TurnStatus::Cancelled, out);
            return;
        }
        if is_harness_text(prompt) {
            return;
        }
        // A new prompt always starts a new turn, closing one that never reached end_turn.
        self.close_turn(TurnStatus::Ok, out);
        self.open_turn(out);
        let message_id = format!("user-{uuid}");
        out.push(AgentEvent::MessageDelta {
            turn_id: self.turn_id(),
            message_id: message_id.clone(),
            role: MessageRole::User,
            text: prompt.to_string(),
            content_kind: MessageContentKind::Text,
            text_mode: MessageTextMode::Append,
        });
        out.push(AgentEvent::MessageCompleted {
            turn_id: self.turn_id(),
            message_id,
            role: MessageRole::User,
            text: prompt.to_string(),
            content_kind: MessageContentKind::Text,
            duration_ms: None,
        });
    }

    fn map_assistant(&mut self, value: &Value, uuid: &str, out: &mut Vec<AgentEvent>) {
        self.open_turn(out);
        let turn_id = self.turn_id();
        let Some(blocks) = value.pointer("/message/content").and_then(Value::as_array) else {
            return;
        };
        for (i, block) in blocks.iter().enumerate() {
            match block.get("type").and_then(Value::as_str) {
                Some(kind @ ("text" | "thinking")) => {
                    let (key, content_kind) = if kind == "text" {
                        ("text", MessageContentKind::Text)
                    } else {
                        ("thinking", MessageContentKind::Reasoning)
                    };
                    let text = block.get(key).and_then(Value::as_str).unwrap_or("");
                    if text.trim().is_empty() {
                        continue;
                    }
                    let message_id = format!("{uuid}:{kind}:{i}");
                    out.push(AgentEvent::MessageDelta {
                        turn_id: turn_id.clone(),
                        message_id: message_id.clone(),
                        role: MessageRole::Assistant,
                        text: text.to_string(),
                        content_kind,
                        text_mode: MessageTextMode::Append,
                    });
                    out.push(AgentEvent::MessageCompleted {
                        turn_id: turn_id.clone(),
                        message_id,
                        role: MessageRole::Assistant,
                        text: text.to_string(),
                        content_kind,
                        duration_ms: None,
                    });
                }
                Some("tool_use") => {
                    let tool_name = block
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string();
                    out.push(AgentEvent::ToolStarted {
                        turn_id: turn_id.clone(),
                        tool_id: block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string(),
                        name: tool_name.clone(),
                        input_summary: block
                            .get("input")
                            .map(Value::to_string)
                            .unwrap_or_default(),
                        tool_state: None,
                        title: None,
                    });
                    if tool_name == "TodoWrite" {
                        if let Some(plan_event) = todo_write_to_plan_updated(block, &turn_id) {
                            out.push(plan_event);
                        }
                    }
                }
                _ => {}
            }
        }
        if value.pointer("/message/stop_reason").and_then(Value::as_str) == Some("end_turn") {
            self.close_turn(TurnStatus::Ok, out);
        }
    }
}

/// Text Claude's harness writes as user records (slash command echoes, hook output, reminders).
fn is_harness_text(text: &str) -> bool {
    const PREFIXES: [&str; 5] = [
        "<command-name>",
        "<command-message>",
        "<local-command-",
        "<system-reminder>",
        "Caveat: The messages below were generated by the user while running local commands",
    ];
    PREFIXES.iter().any(|p| text.starts_with(p))
}

fn tool_result(block: &Value, turn_id: &str) -> AgentEvent {
    let is_error = block.get("is_error").and_then(Value::as_bool).unwrap_or(false);
    let output_summary = match block.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    AgentEvent::ToolCompleted {
        turn_id: turn_id.to_string(),
        tool_id: block
            .get("tool_use_id")
            .and_then(Value::as_str)
            .unwrap_or("tool")
            .to_string(),
        status: if is_error { ToolStatus::Error } else { ToolStatus::Ok },
        output_summary,
        tool_state: None,
        title: None,
    }
}

fn todo_write_to_plan_updated(block: &Value, turn_id: &str) -> Option<AgentEvent> {
    let input = block.get("input")?;
    let todos = input.get("todos")?.as_array()?;

    let items: Vec<PlanItem> = todos
        .iter()
        .filter_map(|todo| {
            let text = todo.get("content")?.as_str()?.to_string();
            let status_str = todo.get("status")?.as_str()?;
            let status = match status_str {
                "in_progress" => PlanStatus::InProgress,
                "completed" => PlanStatus::Done,
                _ => PlanStatus::Pending,
            };
            Some(PlanItem { text, status })
        })
        .collect();

    if items.is_empty() {
        return None;
    }

    Some(AgentEvent::PlanUpdated {
        turn_id: Some(turn_id.to_string()),
        items,
        explanation: None,
    })
}

/// Parse a whole session file into events. Returns the events and how many turns they hold.
pub fn parse_history(text: &str) -> (Vec<AgentEvent>, u64) {
    let mut replay = SessionReplay::default();
    let mut events = Vec::new();
    for line in text.lines() {
        events.extend(replay.push_line(line));
    }
    events.extend(replay.finish());
    (events, replay.turns())
}

pub fn read_history(cwd: &str, session_id: &str) -> Result<(Vec<AgentEvent>, u64), String> {
    let path = session_path(cwd, session_id).ok_or_else(|| "invalid session id".to_string())?;
    let text = std::fs::read_to_string(&path)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(parse_history(&text))
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PastSession {
    pub id: String,
    pub title: String,
    /// Milliseconds since the Unix epoch (file modification time).
    pub updated_at: i64,
}

const HEAD_BYTES: usize = 128 * 1024;

fn title_from_head(head: &str) -> Option<String> {
    for line in head.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("user")
            || value.get("isSidechain").and_then(Value::as_bool) == Some(true)
            || value.get("isMeta").and_then(Value::as_bool) == Some(true)
        {
            continue;
        }
        let text = match value.pointer("/message/content") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Array(blocks)) => blocks
                .iter()
                .find_map(|b| b.get("text").and_then(Value::as_str))
                .unwrap_or("")
                .to_string(),
            _ => String::new(),
        };
        let text = text.trim();
        if text.is_empty() || is_harness_text(text) || text.starts_with("[Request interrupted") {
            continue;
        }
        let one_line: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
        return Some(if one_line.chars().count() > 80 {
            let cut: String = one_line.chars().take(80).collect();
            format!("{cut}…")
        } else {
            one_line
        });
    }
    None
}

fn read_head(path: &Path) -> String {
    let Ok(file) = std::fs::File::open(path) else {
        return String::new();
    };
    let mut buf = Vec::with_capacity(HEAD_BYTES);
    let _ = file.take(HEAD_BYTES as u64).read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

/// Past chats of a project, newest first. Files with no user prompt (never answered) are skipped.
pub fn list_sessions(cwd: &str) -> Vec<PastSession> {
    let Some(dir) = project_dir(cwd) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut sessions: Vec<PastSession> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                return None;
            }
            let id = path.file_stem()?.to_str()?.to_string();
            let title = title_from_head(&read_head(&path))?;
            let updated_at = entry
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as i64;
            Some(PastSession {
                id,
                title,
                updated_at,
            })
        })
        .collect();
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/claude_session.jsonl");

    fn kinds(events: &[AgentEvent]) -> Vec<&'static str> {
        events
            .iter()
            .map(|e| match e {
                AgentEvent::TurnStarted { .. } => "turn_started",
                AgentEvent::MessageDelta { role: MessageRole::User, .. } => "user_delta",
                AgentEvent::MessageDelta { .. } => "delta",
                AgentEvent::MessageCompleted { role: MessageRole::User, .. } => "user_done",
                AgentEvent::MessageCompleted { .. } => "done",
                AgentEvent::ToolStarted { .. } => "tool_started",
                AgentEvent::ToolCompleted { .. } => "tool_completed",
                AgentEvent::TurnCompleted { status: TurnStatus::Cancelled, .. } => "cancelled",
                AgentEvent::TurnCompleted { .. } => "turn_completed",
                _ => "other",
            })
            .collect()
    }

    #[test]
    fn encodes_windows_cwd_like_claude() {
        assert_eq!(
            encode_cwd(r"C:\Users\Ren-pc\AppData\Local\Temp\loomria-e2e-repo"),
            "C--Users-Ren-pc-AppData-Local-Temp-loomria-e2e-repo"
        );
    }

    #[test]
    fn rejects_session_ids_that_escape_the_folder() {
        assert!(session_path("C:\\x", "../evil").is_none());
        assert!(session_path("C:\\x", "").is_none());
        assert!(session_path("C:\\x", "921cbe39-7eb9-4354-916e-1355c1aa85c9").is_some());
    }

    #[test]
    fn real_session_replays_prompts_tools_and_replies_in_order() {
        let (events, turns) = parse_history(FIXTURE);
        assert!(turns >= 3, "turns = {turns}");
        let k = kinds(&events);
        assert_eq!(&k[..5], ["turn_started", "user_delta", "user_done", "tool_started", "tool_completed"]);
        assert!(k.contains(&"delta") && k.contains(&"done"));
        assert!(k.contains(&"tool_started") && k.contains(&"tool_completed"));
        // every started turn is closed exactly once
        assert_eq!(
            k.iter().filter(|x| **x == "turn_started").count(),
            k.iter().filter(|x| **x == "turn_completed" || **x == "cancelled").count()
        );
        // no harness noise leaks through as a user message
        for e in &events {
            if let AgentEvent::MessageCompleted { role: MessageRole::User, text, .. } = e {
                assert!(!text.starts_with('<'), "{text}");
            }
        }
    }

    #[test]
    fn interrupt_marker_cancels_the_open_turn_without_a_user_bubble() {
        let mut r = SessionReplay::default();
        let mut ev = r.push_line(r#"{"type":"user","uuid":"u1","message":{"role":"user","content":"long task"}}"#);
        ev.extend(r.push_line(r#"{"type":"user","uuid":"u2","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]}}"#));
        assert_eq!(kinds(&ev), ["turn_started", "user_delta", "user_done", "cancelled"]);
    }

    #[test]
    fn sidechain_and_meta_records_are_skipped() {
        let mut r = SessionReplay::default();
        assert!(r.push_line(r#"{"type":"user","isSidechain":true,"uuid":"u","message":{"content":"x"}}"#).is_empty());
        assert!(r.push_line(r#"{"type":"user","isMeta":true,"uuid":"u","message":{"content":"x"}}"#).is_empty());
        assert!(r.push_line(r#"{"type":"attachment","uuid":"u"}"#).is_empty());
        assert!(r.push_line("not json").is_empty());
    }

    #[test]
    fn tool_use_and_result_pair_by_id() {
        let mut r = SessionReplay::default();
        r.push_line(r#"{"type":"user","uuid":"u1","message":{"content":"run it"}}"#);
        let a = r.push_line(r#"{"type":"assistant","uuid":"a1","message":{"stop_reason":"tool_use","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"echo hi"}}]}}"#);
        let b = r.push_line(r#"{"type":"user","uuid":"u2","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"hi"}]}}"#);
        assert!(matches!(&a[0], AgentEvent::ToolStarted { tool_id, name, .. } if tool_id == "t1" && name == "Bash"));
        assert!(matches!(&b[0], AgentEvent::ToolCompleted { tool_id, status: ToolStatus::Ok, output_summary, .. } if tool_id == "t1" && output_summary == "hi"));
    }

    #[test]
    fn title_is_the_first_real_prompt_trimmed() {
        let head = concat!(
            r#"{"type":"user","uuid":"a","message":{"content":"<command-name>/clear</command-name>"}}"#,
            "\n",
            r#"{"type":"user","uuid":"b","message":{"content":"  fix   the\nbug "}}"#,
            "\n"
        );
        assert_eq!(title_from_head(head).as_deref(), Some("fix the bug"));
        assert_eq!(title_from_head("{}\n"), None);
    }

    #[test]
    fn todo_write_to_plan_updated_live() {
        let mut r = SessionReplay::default();
        r.push_line(r#"{"type":"user","uuid":"u1","message":{"content":"make a todo list"}}"#);
        let a = r.push_line(r#"{"type":"assistant","uuid":"a1","message":{"stop_reason":"tool_use","content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[{"content":"step 1","status":"pending"},{"content":"step 2","status":"in_progress"},{"content":"step 3","status":"completed"}]}}]}}"#);
        assert!(matches!(&a[0], AgentEvent::ToolStarted { tool_id, name, .. } if tool_id == "t1" && name == "TodoWrite"));
        assert!(matches!(&a[1], AgentEvent::PlanUpdated { turn_id, items, .. } if turn_id.is_some() && items.len() == 3));
        if let AgentEvent::PlanUpdated { items, .. } = &a[1] {
            assert_eq!(items[0].text, "step 1");
            assert_eq!(items[0].status, PlanStatus::Pending);
            assert_eq!(items[1].text, "step 2");
            assert_eq!(items[1].status, PlanStatus::InProgress);
            assert_eq!(items[2].text, "step 3");
            assert_eq!(items[2].status, PlanStatus::Done);
        } else {
            panic!("Expected PlanUpdated event");
        }
    }

    #[test]
    fn todo_write_status_mapping() {
        let mut r = SessionReplay::default();
        r.push_line(r#"{"type":"user","uuid":"u1","message":{"content":"todos"}}"#);
        let a = r.push_line(r#"{"type":"assistant","uuid":"a1","message":{"stop_reason":"tool_use","content":[{"type":"tool_use","id":"t1","name":"TodoWrite","input":{"todos":[{"content":"one","status":"unknown"}]}}]}}"#);
        if let AgentEvent::PlanUpdated { items, .. } = &a[1] {
            assert_eq!(items[0].status, PlanStatus::Pending);
        } else {
            panic!("Expected PlanUpdated event");
        }
    }
}
