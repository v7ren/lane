use crate::protocol::{
    AgentEvent, ApprovalDecision, ApprovalKind, MessageContentKind, MessageRole, MessageTextMode,
    ToolStatus, TurnStatus,
};
use parking_lot::Mutex;
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};

/// The approval id of a server request: its JSON-RPC id as a string.
pub fn server_request_key(value: &Value) -> String {
    value
        .get("id")
        .map(|v| match v.as_str() {
            Some(s) => s.to_string(),
            None => v.to_string(),
        })
        .unwrap_or_else(|| "approval".into())
}

pub fn map_codex_server_request(value: &Value, turn_counter: &AtomicU64) -> Vec<AgentEvent> {
    let method = value.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let request_id = server_request_key(value);
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
        "execCommandApproval" => {
            let detail = match params.get("command") {
                Some(Value::Array(parts)) => parts
                    .iter()
                    .filter_map(|p| p.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
                Some(Value::String(s)) => s.clone(),
                _ => params.to_string(),
            };
            vec![AgentEvent::ApprovalRequested {
                approval_id: request_id,
                title: "Command approval".to_string(),
                detail,
                kind: ApprovalKind::Command,
                options: vec![
                    ApprovalDecision::AllowOnce,
                    ApprovalDecision::AllowAlways,
                    ApprovalDecision::Deny,
                ],
            }]
        }
        "applyPatchApproval" => {
            let detail = params
                .get("fileChanges")
                .and_then(|c| c.as_object())
                .map(|files| files.keys().cloned().collect::<Vec<_>>().join("\n"))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| params.to_string());
            vec![AgentEvent::ApprovalRequested {
                approval_id: request_id,
                title: "File change approval".to_string(),
                detail,
                kind: ApprovalKind::Edit,
                options: vec![
                    ApprovalDecision::AllowOnce,
                    ApprovalDecision::AllowAlways,
                    ApprovalDecision::Deny,
                ],
            }]
        }
        "item/tool/requestUserInput" => {
            // Same shape the Claude question dock reads; `id` lets the reply find the question again.
            let questions: Vec<Value> = params
                .get("questions")
                .and_then(|q| q.as_array())
                .map(|qs| {
                    qs.iter()
                        .map(|q| {
                            serde_json::json!({
                                "id": q.get("id").cloned().unwrap_or(Value::Null),
                                "header": q.get("header").cloned().unwrap_or(Value::Null),
                                "question": q.get("question").cloned().unwrap_or(Value::Null),
                                "options": q.get("options").cloned().unwrap_or_else(|| serde_json::json!([])),
                                "multiSelect": false,
                                "isSecret": q.get("isSecret").cloned().unwrap_or(Value::Bool(false)),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            vec![AgentEvent::ApprovalRequested {
                approval_id: request_id,
                title: "Question".to_string(),
                detail: Value::Array(questions).to_string(),
                kind: ApprovalKind::Question,
                options: vec![ApprovalDecision::AllowOnce, ApprovalDecision::Deny],
            }]
        }
        _ => Vec::new(),
    }
}

/// One id for every event of a turn: the server turn id carried by the notification
/// (`params.turnId`, or `params.turn.id` on turn/started|completed), else the turn
/// the hub already saw start, else the local counter.
fn resolve_turn_id(
    params: &Value,
    turn_counter: &AtomicU64,
    active_turn_id: &Mutex<Option<String>>,
) -> String {
    params
        .get("turnId")
        .and_then(|v| v.as_str())
        .or_else(|| params.pointer("/turn/id").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .or_else(|| active_turn_id.lock().clone())
        .unwrap_or_else(|| turn_counter.load(Ordering::SeqCst).to_string())
}

fn str_at<'a>(v: &'a Value, ptr: &str) -> Option<&'a str> {
    v.pointer(ptr).and_then(|x| x.as_str())
}

fn command_summary(item: &Value) -> String {
    str_at(item, "/commandActions/0/command")
        .or_else(|| str_at(item, "/command"))
        .unwrap_or("")
        .to_string()
}

fn file_change_paths(item: &Value) -> Vec<String> {
    item.get("changes")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c.get("path").and_then(|p| p.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn mcp_name(item: &Value) -> String {
    let server = str_at(item, "/server").unwrap_or("mcp");
    let tool = str_at(item, "/tool").unwrap_or("tool");
    format!("{server}/{tool}")
}

fn tool_started(turn_id: String, item: &Value, name: String, input_summary: String) -> AgentEvent {
    AgentEvent::ToolStarted {
        turn_id,
        tool_id: str_at(item, "/id").unwrap_or("item").to_string(),
        name,
        input_summary,
        tool_state: Some("running".into()),
        title: None,
    }
}

fn map_item_started(item: &Value, turn_id: String) -> Vec<AgentEvent> {
    match str_at(item, "/type").unwrap_or("") {
        "commandExecution" => {
            vec![tool_started(turn_id, item, "command".into(), command_summary(item))]
        }
        "fileChange" => vec![tool_started(
            turn_id,
            item,
            "fileChange".into(),
            file_change_paths(item).join(", "),
        )],
        "mcpToolCall" => {
            let args = item
                .get("arguments")
                .map(|a| a.to_string())
                .unwrap_or_default();
            vec![tool_started(turn_id, item, mcp_name(item), args)]
        }
        "webSearch" => vec![tool_started(
            turn_id,
            item,
            "webSearch".into(),
            str_at(item, "/query").unwrap_or("").to_string(),
        )],
        _ => Vec::new(),
    }
}

fn tool_status(item: &Value) -> ToolStatus {
    let status = str_at(item, "/status").unwrap_or("completed");
    let exit_ok = item
        .get("exitCode")
        .and_then(|c| c.as_i64())
        .map(|c| c == 0)
        .unwrap_or(true);
    let has_error = item.get("error").map_or(false, |e| !e.is_null());
    if matches!(status, "failed" | "declined") || !exit_ok || has_error {
        ToolStatus::Error
    } else {
        ToolStatus::Ok
    }
}

fn reasoning_text(item: &Value) -> String {
    let join = |key: &str| -> String {
        item.get(key)
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default()
    };
    let summary = join("summary");
    if summary.is_empty() {
        join("content")
    } else {
        summary
    }
}

fn tool_completed(
    turn_id: String,
    item: &Value,
    status: ToolStatus,
    output_summary: String,
) -> AgentEvent {
    AgentEvent::ToolCompleted {
        turn_id,
        tool_id: str_at(item, "/id").unwrap_or("item").to_string(),
        status,
        output_summary,
        tool_state: str_at(item, "/status").map(String::from),
        title: None,
    }
}

fn map_item_completed(item: &Value, turn_id: String) -> Vec<AgentEvent> {
    let id = str_at(item, "/id").unwrap_or("item").to_string();
    match str_at(item, "/type").unwrap_or("") {
        "agentMessage" => vec![AgentEvent::MessageCompleted {
            turn_id,
            message_id: id,
            role: MessageRole::Assistant,
            text: str_at(item, "/text").unwrap_or("").to_string(),
            content_kind: MessageContentKind::Text,
            duration_ms: None,
        }],
        "reasoning" => {
            let text = reasoning_text(item);
            if text.is_empty() {
                Vec::new()
            } else {
                vec![AgentEvent::MessageCompleted {
                    turn_id,
                    message_id: id,
                    role: MessageRole::Assistant,
                    text,
                    content_kind: MessageContentKind::Reasoning,
                    duration_ms: None,
                }]
            }
        }
        "commandExecution" => {
            let output = str_at(item, "/aggregatedOutput").unwrap_or("").trim_end();
            let summary = if output.is_empty() {
                item.get("exitCode")
                    .and_then(|c| c.as_i64())
                    .map(|c| format!("exit code {c}"))
                    .unwrap_or_default()
            } else {
                output.to_string()
            };
            vec![tool_completed(turn_id, item, tool_status(item), summary)]
        }
        "fileChange" => {
            let status = tool_status(item);
            let paths = file_change_paths(item);
            let mut out = vec![tool_completed(turn_id, item, status, paths.join(", "))];
            if status == ToolStatus::Ok && !paths.is_empty() {
                out.push(AgentEvent::FilesChanged { paths });
            }
            out
        }
        "mcpToolCall" => {
            let summary = str_at(item, "/error/message")
                .map(String::from)
                .or_else(|| {
                    item.get("result")
                        .filter(|r| !r.is_null())
                        .map(|r| r.to_string())
                })
                .unwrap_or_default();
            vec![tool_completed(turn_id, item, tool_status(item), summary)]
        }
        "webSearch" => vec![tool_completed(
            turn_id,
            item,
            ToolStatus::Ok,
            str_at(item, "/query").unwrap_or("").to_string(),
        )],
        _ => Vec::new(),
    }
}

fn diff_paths(diff: &str) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    for line in diff.lines() {
        if let Some(rest) = line.strip_prefix("+++ ") {
            let p = rest.trim().trim_start_matches("b/");
            if p != "/dev/null" && !p.is_empty() && !paths.iter().any(|x| x == p) {
                paths.push(p.to_string());
            }
        }
    }
    paths
}

pub fn map_codex_notification(
    value: &Value,
    turn_counter: &AtomicU64,
    active_turn_id: &Mutex<Option<String>>,
) -> Vec<AgentEvent> {
    let method = value.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    let turn_id = resolve_turn_id(&params, turn_counter, active_turn_id);
    match method {
        "turn/started" => {
            *active_turn_id.lock() = Some(turn_id.clone());
            vec![AgentEvent::TurnStarted { turn_id }]
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
            *active_turn_id.lock() = None;
            vec![AgentEvent::TurnCompleted {
                turn_id,
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
                content_kind: MessageContentKind::Text,
                text_mode: MessageTextMode::Append,
            }]
        }
        "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" => {
            let text = params.get("delta").and_then(|d| d.as_str()).unwrap_or("");
            vec![AgentEvent::MessageDelta {
                turn_id,
                message_id: params
                    .get("itemId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("reasoning")
                    .to_string(),
                role: MessageRole::Assistant,
                text: text.to_string(),
                content_kind: MessageContentKind::Reasoning,
                text_mode: MessageTextMode::Append,
            }]
        }
        "item/started" => params
            .get("item")
            .map(|item| map_item_started(item, turn_id))
            .unwrap_or_default(),
        "item/completed" => params
            .get("item")
            .map(|item| map_item_completed(item, turn_id))
            .unwrap_or_default(),
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
                content_kind: MessageContentKind::Text,
                duration_ms: None,
            }]
        }
        "turn/diff/updated" => {
            let paths = params
                .get("diff")
                .and_then(|d| d.as_str())
                .map(diff_paths)
                .unwrap_or_default();
            if paths.is_empty() {
                Vec::new()
            } else {
                vec![AgentEvent::FilesChanged { paths }]
            }
        }
        "thread/tokenUsage/updated" => {
            let total = params.pointer("/tokenUsage/total");
            let pick = |key: &str| total.and_then(|t| t.get(key)).and_then(|v| v.as_u64());
            if total.is_none() {
                return Vec::new();
            }
            vec![AgentEvent::Usage {
                input_tokens: pick("inputTokens"),
                output_tokens: pick("outputTokens"),
                cost_usd: None,
            }]
        }
        "error" => {
            if params
                .get("willRetry")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                return Vec::new();
            }
            let message = params
                .pointer("/error/message")
                .and_then(|v| v.as_str())
                .or_else(|| params.get("message").and_then(|v| v.as_str()))
                .unwrap_or("codex error")
                .to_string();
            vec![AgentEvent::Error { message }]
        }
        "account/rateLimits/updated" => {
            let limited = ["primary", "secondary"].iter().find_map(|k| {
                let w = params.pointer(&format!("/rateLimits/{k}"))?;
                (w.get("usedPercent").and_then(|p| p.as_f64()).unwrap_or(0.0) >= 100.0)
                    .then(|| w.get("resetsAt").and_then(|r| r.as_i64()))
            });
            match limited {
                Some(reset) => vec![AgentEvent::RateLimited {
                    retry_at_ms: reset.map(|s| s * 1000),
                    message: "Codex rate limit reached".into(),
                }],
                None => Vec::new(),
            }
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

    #[test]
    fn unknown_method_is_dropped() {
        let counter = AtomicU64::new(1);
        let active: Mutex<Option<String>> = Mutex::new(None);
        let value = json!({ "method": "some/future/thing", "params": 7 });
        assert!(map_codex_notification(&value, &counter, &active).is_empty());
    }

    #[test]
    fn legacy_exec_and_patch_approvals_are_not_dropped() {
        let counter = AtomicU64::new(1);
        let exec = map_codex_server_request(
            &json!({"id": 5, "method": "execCommandApproval", "params": {"command": ["git", "status"]}}),
            &counter,
        );
        assert!(matches!(
            &exec[0],
            AgentEvent::ApprovalRequested { approval_id, detail, kind: ApprovalKind::Command, .. }
                if approval_id == "5" && detail == "git status"
        ));
        let patch = map_codex_server_request(
            &json!({"id": 6, "method": "applyPatchApproval", "params": {"fileChanges": {"a.txt": {}}}}),
            &counter,
        );
        assert!(matches!(
            &patch[0],
            AgentEvent::ApprovalRequested { detail, kind: ApprovalKind::Edit, .. } if detail == "a.txt"
        ));
    }

    #[test]
    fn user_input_request_becomes_a_question_with_ids() {
        let counter = AtomicU64::new(1);
        let events = map_codex_server_request(
            &json!({"id": 8, "method": "item/tool/requestUserInput", "params": {"questions": [
                {"id": "q1", "header": "Color", "question": "Pick one", "options": [{"label": "Red", "description": "r"}]}
            ]}}),
            &counter,
        );
        let AgentEvent::ApprovalRequested { detail, kind: ApprovalKind::Question, .. } = &events[0] else {
            panic!("expected a question");
        };
        let parsed: Value = serde_json::from_str(detail).unwrap();
        assert_eq!(parsed[0]["id"], "q1");
        assert_eq!(parsed[0]["question"], "Pick one");
        assert_eq!(parsed[0]["options"][0]["label"], "Red");
    }

    #[test]
    fn unknown_server_request_maps_to_nothing() {
        let counter = AtomicU64::new(1);
        assert!(map_codex_server_request(&json!({"id": 1, "method": "future/thing"}), &counter).is_empty());
    }
}
