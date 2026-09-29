use crate::protocol::{
    AgentEvent, ApprovalDecision, ApprovalKind, MessageRole, TurnStatus,
};
use parking_lot::Mutex;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};

pub fn map_codex_server_request(value: &Value, turn_counter: &AtomicU64) -> Vec<AgentEvent> {
    let method = value.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let request_id = value
        .get("id")
        .map(|v| {
            if let Some(s) = v.as_str() {
                s.to_string()
            } else {
                v.to_string()
            }
        })
        .unwrap_or_else(|| "approval".into());
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    let _turn_id = turn_counter.load(Ordering::SeqCst).to_string();
    match method {
        "item/commandExecution/requestApproval"
        | "item/fileChange/requestApproval"
        | "item/permissions/requestApproval" => {
            let title = params
                .get("title")
                .and_then(|v| v.as_str())
                .or_else(|| {
                    params
                        .pointer("/commandActions/0/name")
                        .and_then(|v| v.as_str())
                })
                .unwrap_or("Command approval")
                .to_string();
            let detail = params
                .get("command")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| params.to_string());
            vec![AgentEvent::ApprovalRequested {
                approval_id: request_id,
                title,
                detail,
                kind: ApprovalKind::Command,
                options: vec![
                    ApprovalDecision::AllowOnce,
                    ApprovalDecision::AllowAlways,
                    ApprovalDecision::Deny,
                ],
            }]
        }
        _ => Vec::new(),
    }
}

pub fn map_codex_notification(
    value: &Value,
    turn_counter: &AtomicU64,
    active_turn_id: &Mutex<Option<String>>,
) -> Vec<AgentEvent> {
    let method = value.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let turn_id = turn_counter.load(Ordering::SeqCst).to_string();
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    match method {
        "turn/started" => {
            let started = params
                .get("turnId")
                .and_then(|v| v.as_str())
                .or_else(|| params.pointer("/turn/id").and_then(|v| v.as_str()))
                .unwrap_or(&turn_id)
                .to_string();
            *active_turn_id.lock() = Some(started.clone());
            vec![AgentEvent::TurnStarted { turn_id: started }]
        }
        "turn/completed" => {
            let status = params
                .pointer("/turn/status")
                .and_then(|v| v.as_str())
                .unwrap_or("completed");
            let turn_status = match status {
                "interrupted" => TurnStatus::Cancelled,
                "failed" => TurnStatus::Error,
                _ => TurnStatus::Ok,
            };
            let error = if turn_status == TurnStatus::Error {
                params
                    .pointer("/turn/error/message")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            } else {
                None
            };
            let completed_turn = params
                .pointer("/turn/id")
                .and_then(|v| v.as_str())
                .unwrap_or(&turn_id)
                .to_string();
            *active_turn_id.lock() = None;
            vec![AgentEvent::TurnCompleted {
                turn_id: completed_turn,
                status: turn_status,
                error,
            }]
        }
        "item/agentMessage/delta" | "thread/item/delta" => {
            let text = params
                .get("delta")
                .and_then(|d| d.as_str())
                .or_else(|| params.pointer("/item/text").and_then(|t| t.as_str()))
                .unwrap_or("");
            vec![AgentEvent::MessageDelta {
                turn_id,
                message_id: params
                    .get("itemId")
                    .or_else(|| params.pointer("/item/id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("assistant")
                    .to_string(),
                role: MessageRole::Assistant,
                text: text.to_string(),
                content_kind: crate::protocol::MessageContentKind::Text,
                text_mode: crate::protocol::MessageTextMode::Append,
            }]
        }
        "item/agentMessage/completed" | "thread/item/completed" => {
            let text = params
                .pointer("/item/text")
                .and_then(|t| t.as_str())
                .unwrap_or("");
            vec![AgentEvent::MessageCompleted {
                turn_id,
                message_id: params
                    .pointer("/item/id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("assistant")
                    .to_string(),
                role: MessageRole::Assistant,
                text: text.to_string(),
                content_kind: crate::protocol::MessageContentKind::Text,
                duration_ms: None,
            }]
        }
        "exec/command/requestApproval"
        | "command/requestApproval"
        | "item/commandExecution/requestApproval"
        | "item/permissions/requestApproval" => map_codex_server_request(value, turn_counter),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_server_approval_request() {
        let counter = AtomicU64::new(1);
        let active: Mutex<Option<String>> = Mutex::new(None);
        let value = json!({
            "id": 42,
            "method": "item/commandExecution/requestApproval",
            "params": { "command": "echo hi", "itemId": "item-1" }
        });
        let events = map_codex_server_request(&value, &counter);
        assert!(matches!(
            events.first(),
            Some(AgentEvent::ApprovalRequested { approval_id, detail, .. })
                if approval_id == "42" && detail.contains("echo hi")
        ));
        let _ = active;
    }

    #[test]
    fn maps_interrupted_turn() {
        let counter = AtomicU64::new(1);
        let active: Mutex<Option<String>> = Mutex::new(None);
        let value = json!({
            "method": "turn/completed",
            "params": { "turn": { "id": "t1", "status": "interrupted" } }
        });
        let events = map_codex_notification(&value, &counter, &active);
        assert!(matches!(
            events.first(),
            Some(AgentEvent::TurnCompleted { status: TurnStatus::Cancelled, .. })
        ));
    }
}
