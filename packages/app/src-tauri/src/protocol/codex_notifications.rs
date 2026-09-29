use crate::protocol::{
    AgentEvent, ApprovalDecision, ApprovalKind, MessageRole, TurnStatus,
};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};

pub fn map_codex_notification(value: &Value, turn_counter: &AtomicU64) -> Vec<AgentEvent> {
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
            let text = params.get("delta").and_then(|d| d.as_str()).unwrap_or("");
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
        "exec/command/requestApproval" | "command/requestApproval" => {
            vec![AgentEvent::ApprovalRequested {
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
            }]
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_approval_notification() {
        let counter = AtomicU64::new(1);
        let value = json!({
            "method": "exec/command/requestApproval",
            "params": { "requestId": "r1", "command": "echo hi" }
        });
        let events = map_codex_notification(&value, &counter);
        assert!(matches!(
            events.first(),
            Some(AgentEvent::ApprovalRequested { approval_id, .. }) if approval_id == "r1"
        ));
    }
}
