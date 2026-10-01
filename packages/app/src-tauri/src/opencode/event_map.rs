//! Map OpenCode server SSE payloads to universal `AgentEvent`s.

use crate::protocol::{
    AgentEvent, ApprovalDecision, ApprovalKind, MessageContentKind, MessageRole,
    MessageTextMode, ToolStatus, TurnStatus,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Debug, Default)]
pub struct OpenCodeMapperState {
    roles: HashMap<String, MessageRole>,
    buffers: HashMap<(String, MessageContentKind), String>,
    completed: HashSet<(String, MessageContentKind)>,
}

impl OpenCodeMapperState {
    pub fn role_for(&self, message_id: &str) -> MessageRole {
        self.roles
            .get(message_id)
            .copied()
            .unwrap_or(MessageRole::Assistant)
    }

    fn set_role(&mut self, message_id: &str, role: MessageRole) {
        self.roles.insert(message_id.to_string(), role);
    }

    fn buffer_key(message_id: &str, kind: MessageContentKind) -> (String, MessageContentKind) {
        (message_id.to_string(), kind)
    }

    fn push_text_delta(
        &mut self,
        message_id: &str,
        kind: MessageContentKind,
        text: &str,
    ) -> Option<(String, MessageTextMode)> {
        if text.is_empty() {
            return None;
        }
        let key = Self::buffer_key(message_id, kind);
        let prev = self.buffers.get(&key).map(String::as_str).unwrap_or("");
        if text == prev {
            return None;
        }
        if text.starts_with(prev) {
            let delta = text[prev.len()..].to_string();
            self.buffers.insert(key, text.to_string());
            if delta.is_empty() {
                return None;
            }
            Some((delta, MessageTextMode::Append))
        } else {
            self.buffers.insert(key, text.to_string());
            Some((text.to_string(), MessageTextMode::Replace))
        }
    }

    fn buffer_text(&self, message_id: &str, kind: MessageContentKind) -> String {
        self.buffers
            .get(&Self::buffer_key(message_id, kind))
            .cloned()
            .unwrap_or_default()
    }

    fn mark_completed(&mut self, message_id: &str, kind: MessageContentKind) -> bool {
        self.completed.insert(Self::buffer_key(message_id, kind))
    }

    fn is_completed(&self, message_id: &str, kind: MessageContentKind) -> bool {
        self.completed.contains(&Self::buffer_key(message_id, kind))
    }

    fn complete_content(
        &mut self,
        message_id: &str,
        kind: MessageContentKind,
        turn_id: &str,
        duration_ms: Option<u64>,
    ) -> Option<AgentEvent> {
        if self.is_completed(message_id, kind) {
            return None;
        }
        let text = self.buffer_text(message_id, kind);
        if text.is_empty() && kind == MessageContentKind::Reasoning {
            self.mark_completed(message_id, kind);
            return None;
        }
        if text.is_empty() && kind == MessageContentKind::Text {
            return None;
        }
        self.mark_completed(message_id, kind);
        Some(AgentEvent::MessageCompleted {
            turn_id: turn_id.to_string(),
            message_id: message_id.to_string(),
            role: self.role_for(message_id),
            text,
            content_kind: kind,
            duration_ms,
        })
    }

    pub fn finalize_open_messages(&mut self, turn_id: &str) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        let message_ids: Vec<String> = self
            .buffers
            .keys()
            .map(|(id, _)| id.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        for message_id in message_ids {
            for kind in [MessageContentKind::Reasoning, MessageContentKind::Text] {
                if let Some(ev) = self.complete_content(&message_id, kind, turn_id, None) {
                    out.push(ev);
                }
            }
        }
        out
    }
}

pub fn map_opencode_event(
    value: &Value,
    session_id: &str,
    turn_counter: &Arc<AtomicU64>,
    state: &mut OpenCodeMapperState,
) -> Vec<AgentEvent> {
    if !event_matches_session(value, session_id) {
        return Vec::new();
    }

    let mut out = Vec::new();
    let event_type = value
        .get("type")
        .or_else(|| value.get("event"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let turn_id = turn_counter.load(Ordering::SeqCst).to_string();

    match event_type {
        "session.idle" | "session.status" | "session.updated" => {
            let status = value
                .get("properties")
                .and_then(|p| p.get("status"))
                .and_then(|s| s.as_str())
                .or_else(|| {
                    value
                        .pointer("/properties/session/status")
                        .and_then(|s| s.as_str())
                });
            if status == Some("idle") || event_type == "session.idle" {
                out.extend(state.finalize_open_messages(&turn_id));
                out.push(AgentEvent::TurnCompleted {
                    turn_id,
                    status: TurnStatus::Ok,
                    error: None,
                });
            }
        }
        "message.updated" => {
            out.extend(map_message_updated(value, &turn_id, state));
        }
        "message.part.updated" => {
            if let Some(events) = map_message_part(value, &turn_id, state) {
                out.extend(events);
            }
        }
        "message.removed" => {
            if let Some(message_id) = value
                .pointer("/properties/info/id")
                .or_else(|| value.pointer("/properties/messageID"))
                .and_then(|v| v.as_str())
            {
                state.roles.remove(message_id);
            }
        }
        "permission.asked" | "permission.updated" => {
            if let Some(ev) = map_permission(value) {
                out.push(ev);
            }
        }
        _ => {
            if let Some(text) = value
                .pointer("/properties/part/text")
                .and_then(|t| t.as_str())
            {
                let message_id = value
                    .pointer("/properties/part/messageID")
                    .or_else(|| value.pointer("/properties/part/id"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("assistant")
                    .to_string();
                let role = state.role_for(&message_id);
                out.push(AgentEvent::MessageDelta {
                    turn_id: turn_id.clone(),
                    message_id,
                    role,
                    text: text.to_string(),
                    content_kind: MessageContentKind::Text,
                    text_mode: MessageTextMode::Append,
                });
            }
        }
    }

    if event_type.contains("error") || event_type == "session.error" {
        if let Some(msg) = value
            .pointer("/properties/error")
            .and_then(|v| v.as_str())
            .or_else(|| value.get("message").and_then(|m| m.as_str()))
        {
            out.push(AgentEvent::Error {
                message: msg.to_string(),
            });
        }
    }

    out
}

pub fn event_matches_session(value: &Value, session_id: &str) -> bool {
    let Some(found) = event_session_id(value) else {
        return true;
    };
    found == session_id
}

pub fn event_session_id(value: &Value) -> Option<&str> {
    value
        .pointer("/properties/sessionID")
        .and_then(|v| v.as_str())
        .or_else(|| value.pointer("/properties/sessionId").and_then(|v| v.as_str()))
        .or_else(|| value.pointer("/properties/session/id").and_then(|v| v.as_str()))
        .or_else(|| value.get("sessionID").and_then(|v| v.as_str()))
        .or_else(|| value.get("sessionId").and_then(|v| v.as_str()))
}

fn map_message_updated(
    value: &Value,
    turn_id: &str,
    state: &mut OpenCodeMapperState,
) -> Vec<AgentEvent> {
    let info = value
        .pointer("/properties/info")
        .or_else(|| value.pointer("/properties/message/info"));
    let Some(info) = info else {
        return Vec::new();
    };
    let Some(message_id) = info.get("id").and_then(|v| v.as_str()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    if let Some(role) = info.get("role").and_then(|v| v.as_str()) {
        state.set_role(message_id, parse_role(role));
    }
    if let Some(meta) = message_meta_events(info, turn_id, message_id) {
        out.extend(meta);
    }
    if info.pointer("/time/completed").is_some() {
        for kind in [MessageContentKind::Reasoning, MessageContentKind::Text] {
            if let Some(ev) = state.complete_content(message_id, kind, turn_id, None) {
                out.push(ev);
            }
        }
    }
    out
}

fn message_meta_events(info: &Value, turn_id: &str, message_id: &str) -> Option<Vec<AgentEvent>> {
    let role = info.get("role").and_then(|v| v.as_str()).unwrap_or("");
    if !role.eq_ignore_ascii_case("assistant") {
        return None;
    }
    let agent = info
        .get("agent")
        .or_else(|| info.get("mode"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let model = info
        .get("modelID")
        .or_else(|| info.pointer("/model/id"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let provider = info
        .get("providerID")
        .or_else(|| info.pointer("/model/providerID"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let duration_ms = info.pointer("/time/created").and_then(|c| c.as_u64()).and_then(|created| {
        info.pointer("/time/completed")
            .and_then(|d| d.as_u64())
            .map(|completed| completed.saturating_sub(created))
    });
    if agent.is_none() && model.is_none() && provider.is_none() && duration_ms.is_none() {
        return None;
    }
    Some(vec![AgentEvent::MessageMeta {
        turn_id: turn_id.to_string(),
        message_id: message_id.to_string(),
        agent,
        model,
        provider,
        duration_ms,
    }])
}

fn map_message_part(
    value: &Value,
    turn_id: &str,
    state: &mut OpenCodeMapperState,
) -> Option<Vec<AgentEvent>> {
    let part = value.pointer("/properties/part")?;
    let part_type = part.get("type")?.as_str()?;
    let message_id = part
        .get("messageID")
        .or_else(|| part.get("message_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("msg")
        .to_string();
    let role = state.role_for(&message_id);
    match part_type {
        "text" => map_text_or_reasoning_part(
            part,
            &message_id,
            turn_id,
            role,
            state,
            MessageContentKind::Text,
        ),
        "reasoning" => map_text_or_reasoning_part(
            part,
            &message_id,
            turn_id,
            role,
            state,
            MessageContentKind::Reasoning,
        ),
        "tool" => Some(map_tool_part(part, turn_id)),
        "step-finish" => Some(map_step_finish(part, turn_id)),
        "file" | "patch" => map_file_part(part),
        "step-start" | "agent" | "snapshot" => Some(Vec::new()),
        _ => None,
    }
}

fn map_text_or_reasoning_part(
    part: &Value,
    message_id: &str,
    turn_id: &str,
    role: MessageRole,
    state: &mut OpenCodeMapperState,
    kind: MessageContentKind,
) -> Option<Vec<AgentEvent>> {
    let text = part.get("text").and_then(|v| v.as_str()).unwrap_or("");
    let mut out = Vec::new();
    if let Some((delta, mode)) = state.push_text_delta(message_id, kind, text) {
        out.push(AgentEvent::MessageDelta {
            turn_id: turn_id.to_string(),
            message_id: message_id.to_string(),
            role,
            text: delta,
            content_kind: kind,
            text_mode: mode,
        });
    }
    let done = part
        .get("done")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
        || part.pointer("/time/end").is_some();
    if done {
        let duration_ms = part_duration_ms(part);
        if let Some(ev) = state.complete_content(message_id, kind, turn_id, duration_ms) {
            out.push(ev);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn map_step_finish(part: &Value, turn_id: &str) -> Vec<AgentEvent> {
    let mut out = Vec::new();
    if let Some(tokens) = part.get("tokens") {
        out.push(AgentEvent::Usage {
            input_tokens: tokens.get("input").and_then(|v| v.as_u64()),
            output_tokens: tokens.get("output").and_then(|v| v.as_u64()),
            cost_usd: part.get("cost").and_then(|v| v.as_f64()),
            context_tokens: None,
            context_window: None,
        });
    }
    let _ = turn_id;
    out
}

fn map_file_part(part: &Value) -> Option<Vec<AgentEvent>> {
    let path = part
        .get("path")
        .or_else(|| part.get("file"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let paths: Vec<String> = part
        .get("files")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    item.as_str()
                        .map(str::to_string)
                        .or_else(|| item.get("path").and_then(|p| p.as_str()).map(str::to_string))
                })
                .collect()
        })
        .unwrap_or_default();
    let mut all = paths;
    if let Some(path) = path {
        all.push(path);
    }
    if all.is_empty() {
        return None;
    }
    Some(vec![AgentEvent::FilesChanged { paths: all }])
}

fn map_tool_part(part: &Value, turn_id: &str) -> Vec<AgentEvent> {
    let tool_id = part
        .get("callID")
        .or_else(|| part.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("tool")
        .to_string();
    let name = part
        .get("tool")
        .and_then(|v| v.as_str())
        .unwrap_or("tool")
        .to_string();
    let state_val = part.get("state");
    let status = state_val
        .and_then(|s| s.get("status"))
        .and_then(|s| s.as_str())
        .or_else(|| state_val.and_then(|s| s.as_str()))
        .unwrap_or("");
    let title = state_val
        .and_then(|s| s.get("title"))
        .and_then(|t| t.as_str())
        .map(str::to_string);
    let status_lower = status.to_ascii_lowercase();
    if matches!(
        status_lower.as_str(),
        "completed" | "done" | "success" | "error" | "failed"
    ) {
        vec![AgentEvent::ToolCompleted {
            turn_id: turn_id.to_string(),
            tool_id,
            status: if status_lower.contains("error") || status_lower.contains("fail") {
                ToolStatus::Error
            } else {
                ToolStatus::Ok
            },
            output_summary: state_val
                .and_then(|s| s.get("output"))
                .map(|v| v.to_string())
                .unwrap_or_default(),
            tool_state: Some(status.to_string()),
            title,
        }]
    } else {
        vec![AgentEvent::ToolStarted {
            turn_id: turn_id.to_string(),
            tool_id,
            name,
            input_summary: state_val
                .and_then(|s| s.get("input"))
                .map(|v| v.to_string())
                .or_else(|| part.get("input").map(|v| v.to_string()))
                .unwrap_or_default(),
            tool_state: if status.is_empty() {
                Some("running".into())
            } else {
                Some(status.to_string())
            },
            title,
        }]
    }
}

fn part_duration_ms(part: &Value) -> Option<u64> {
    let start = part.pointer("/time/start").and_then(|v| v.as_u64());
    let end = part.pointer("/time/end").and_then(|v| v.as_u64());
    match (start, end) {
        (Some(s), Some(e)) => Some(e.saturating_sub(s)),
        _ => None,
    }
}

fn parse_role(raw: &str) -> MessageRole {
    if raw.eq_ignore_ascii_case("user") {
        MessageRole::User
    } else {
        MessageRole::Assistant
    }
}

fn map_permission(value: &Value) -> Option<AgentEvent> {
    let id = value
        .pointer("/properties/id")
        .or_else(|| value.get("id"))
        .and_then(|v| v.as_str())?
        .to_string();
    let title = value
        .pointer("/properties/type")
        .and_then(|v| v.as_str())
        .unwrap_or("Permission")
        .to_string();
    let detail = value
        .pointer("/properties/pattern")
        .or_else(|| value.pointer("/properties/command"))
        .and_then(|v| v.as_str())
        .unwrap_or(&id)
        .to_string();
    let kind = if title.to_lowercase().contains("edit") {
        ApprovalKind::Edit
    } else if title.to_lowercase().contains("command") || title.to_lowercase().contains("bash") {
        ApprovalKind::Command
    } else {
        ApprovalKind::Other
    };
    Some(AgentEvent::ApprovalRequested {
        approval_id: id,
        title,
        detail,
        kind,
        options: vec![
            ApprovalDecision::AllowOnce,
            ApprovalDecision::AllowAlways,
            ApprovalDecision::Deny,
        ],
        payload: None,
    })
}

pub fn next_turn(turn_counter: &Arc<AtomicU64>) -> String {
    turn_counter.fetch_add(1, Ordering::SeqCst);
    turn_counter.load(Ordering::SeqCst).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn replay(session_id: &str, inputs: &[Value], counter: &Arc<AtomicU64>) -> Vec<AgentEvent> {
        let mut state = OpenCodeMapperState::default();
        let mut events = Vec::new();
        for input in inputs {
            events.extend(map_opencode_event(input, session_id, counter, &mut state));
        }
        events
    }

    #[test]
    fn idle_scoped_to_session() {
        let counter = Arc::new(AtomicU64::new(1));
        let mut state = OpenCodeMapperState::default();
        let other = map_opencode_event(
            &json!({"type":"session.status","properties":{"sessionID":"other","status":"idle"}}),
            "mine",
            &counter,
            &mut state,
        );
        assert!(other.is_empty());
        let mine = map_opencode_event(
            &json!({"type":"session.status","properties":{"sessionID":"mine","status":"idle"}}),
            "mine",
            &counter,
            &mut state,
        );
        assert!(matches!(mine.first(), Some(AgentEvent::TurnCompleted { .. })));
    }

    #[test]
    fn hi_chat_sequence_roles_reasoning_and_completion() {
        let session_id = "ses_fixture_hi";
        let counter = Arc::new(AtomicU64::new(1));
        let user_msg = "msg_user_hi";
        let asst_msg = "msg_asst_hi";
        let inputs = [
            json!({
                "type": "message.updated",
                "properties": {
                    "sessionID": session_id,
                    "info": {
                        "id": user_msg,
                        "role": "user",
                        "time": { "created": 1000 }
                    }
                }
            }),
            json!({
                "type": "message.part.updated",
                "properties": {
                    "sessionID": session_id,
                    "part": {
                        "type": "text",
                        "text": "hi",
                        "messageID": user_msg
                    }
                }
            }),
            json!({
                "type": "message.updated",
                "properties": {
                    "sessionID": session_id,
                    "info": {
                        "id": user_msg,
                        "role": "user",
                        "time": { "created": 1000, "completed": 1001 }
                    }
                }
            }),
            json!({
                "type": "message.updated",
                "properties": {
                    "sessionID": session_id,
                    "info": {
                        "id": asst_msg,
                        "role": "assistant",
                        "agent": "build",
                        "modelID": "mimo-v2.5",
                        "providerID": "opencode-go",
                        "time": { "created": 2000 }
                    }
                }
            }),
            json!({
                "type": "message.part.updated",
                "properties": {
                    "sessionID": session_id,
                    "part": {
                        "type": "reasoning",
                        "text": "Thinking…",
                        "messageID": asst_msg,
                        "time": { "start": 2001, "end": 4200 }
                    }
                }
            }),
            json!({
                "type": "message.part.updated",
                "properties": {
                    "sessionID": session_id,
                    "part": {
                        "type": "text",
                        "text": "Hi!",
                        "messageID": asst_msg,
                        "time": { "start": 4201, "end": 8100 }
                    }
                }
            }),
            json!({
                "type": "message.part.updated",
                "properties": {
                    "sessionID": session_id,
                    "part": {
                        "type": "step-finish",
                        "messageID": asst_msg,
                        "cost": 0.001,
                        "tokens": { "input": 7226, "output": 4 }
                    }
                }
            }),
            json!({
                "type": "message.updated",
                "properties": {
                    "sessionID": session_id,
                    "info": {
                        "id": asst_msg,
                        "role": "assistant",
                        "agent": "build",
                        "modelID": "mimo-v2.5",
                        "providerID": "opencode-go",
                        "time": { "created": 2000, "completed": 8100 }
                    }
                }
            }),
            json!({
                "type": "session.status",
                "properties": { "sessionID": session_id, "status": "idle" }
            }),
        ];
        let events = replay(session_id, &inputs, &counter);

        let user_completed = events.iter().find(|e| {
            matches!(
                e,
                AgentEvent::MessageCompleted {
                    message_id,
                    role: MessageRole::User,
                    text,
                    content_kind: MessageContentKind::Text,
                    ..
                } if message_id == user_msg && text == "hi"
            )
        });
        assert!(user_completed.is_some(), "user message should complete");

        let reasoning_completed = events.iter().any(|e| {
            matches!(
                e,
                AgentEvent::MessageCompleted {
                    role: MessageRole::Assistant,
                    content_kind: MessageContentKind::Reasoning,
                    ..
                }
            )
        });
        assert!(reasoning_completed, "reasoning should complete separately");

        assert!(
            events.iter().any(|e| matches!(e, AgentEvent::MessageMeta { .. })),
            "assistant meta"
        );
        assert!(
            events.iter().any(|e| matches!(e, AgentEvent::Usage { .. })),
            "usage from step-finish"
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentEvent::TurnCompleted { .. })),
            "turn completed"
        );

        let assistant_text_done = events.iter().any(|e| {
            matches!(
                e,
                AgentEvent::MessageCompleted {
                    message_id,
                    role: MessageRole::Assistant,
                    text,
                    content_kind: MessageContentKind::Text,
                    ..
                } if message_id == asst_msg && text == "Hi!"
            )
        });
        assert!(assistant_text_done);
    }

    #[test]
    fn legacy_done_flag_still_completes() {
        let session_id = "ses_test";
        let counter = Arc::new(AtomicU64::new(1));
        let inputs = [
            json!({
                "type": "message.updated",
                "properties": {
                    "sessionID": session_id,
                    "info": { "id": "m1", "role": "assistant" }
                }
            }),
            json!({"type":"message.part.updated","properties":{"sessionID":session_id,"part":{"type":"text","text":"ok","messageID":"m1","done":false}}}),
            json!({"type":"message.part.updated","properties":{"sessionID":session_id,"part":{"type":"text","text":"ok","messageID":"m1","done":true}}}),
            json!({"type":"session.status","properties":{"sessionID":session_id,"status":"idle"}}),
        ];
        let events = replay(session_id, &inputs, &counter);
        assert!(
            events
                .iter()
                .any(|e| matches!(e, AgentEvent::MessageCompleted { text, .. } if text == "ok"))
        );
    }
}
