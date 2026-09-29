//! Map OpenCode server SSE payloads to universal `AgentEvent`s.

use crate::protocol::{
    AgentEvent, ApprovalDecision, ApprovalKind, MessageRole, ToolStatus, TurnStatus,
};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub fn map_opencode_event(
    value: &Value,
    session_id: &str,
    turn_counter: &Arc<AtomicU64>,
) -> Vec<AgentEvent> {
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
                out.push(AgentEvent::TurnCompleted {
                    turn_id,
                    status: TurnStatus::Ok,
                    error: None,
                });
            }
        }
        "message.part.updated" | "message.updated" => {
            if let Some(events) = map_message_part(value, &turn_id) {
                out.extend(events);
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
                    .pointer("/properties/part/id")
                    .and_then(|t| t.as_str())
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
    }

    if event_type.contains("error") {
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

    let _ = session_id;
    out
}

fn map_message_part(value: &Value, turn_id: &str) -> Option<Vec<AgentEvent>> {
    let part = value.pointer("/properties/part")?;
    let part_type = part.get("type")?.as_str()?;
    match part_type {
        "text" => {
            let text = part.get("text")?.as_str()?.to_string();
            let message_id = part
                .get("messageID")
                .or_else(|| part.get("message_id"))
                .and_then(|v| v.as_str())
                .unwrap_or("msg")
                .to_string();
            let done = part.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
            if done {
                Some(vec![AgentEvent::MessageCompleted {
                    turn_id: turn_id.to_string(),
                    message_id,
                    role: MessageRole::Assistant,
                    text,
                }])
            } else if !text.is_empty() {
                Some(vec![AgentEvent::MessageDelta {
                    turn_id: turn_id.to_string(),
                    message_id,
                    role: MessageRole::Assistant,
                    text,
                }])
            } else {
                None
            }
        }
        "tool" => {
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
            let state = part.get("state").and_then(|s| s.as_str()).unwrap_or("");
            if state == "completed" || state == "error" {
                Some(vec![AgentEvent::ToolCompleted {
                    turn_id: turn_id.to_string(),
                    tool_id,
                    status: if state == "error" {
                        ToolStatus::Error
                    } else {
                        ToolStatus::Ok
                    },
                    output_summary: part
                        .pointer("/state/output")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                }])
            } else {
                Some(vec![AgentEvent::ToolStarted {
                    turn_id: turn_id.to_string(),
                    tool_id,
                    name,
                    input_summary: part
                        .get("input")
                        .map(|v| v.to_string())
                        .unwrap_or_default(),
                }])
            }
        }
        _ => None,
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
    })
}

pub fn next_turn(turn_counter: &Arc<AtomicU64>) -> String {
    turn_counter.fetch_add(1, Ordering::SeqCst);
    turn_counter.load(Ordering::SeqCst).to_string()
}
