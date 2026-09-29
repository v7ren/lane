//! Replay sanitized live captures and raw SSE/WS payloads through mappers + contract checks.

use loomria_app_lib::opencode::event_map::map_opencode_event;
use loomria_app_lib::protocol::codex_notifications::{map_codex_notification, map_codex_server_request};
use loomria_app_lib::protocol::claude_stream_json::ClaudeStreamMapper;
use loomria_app_lib::protocol::{
    assert_approval_flow_contract, assert_prompt_turn_contract, AgentEvent, TurnStatus,
};
use parking_lot::Mutex;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/live")
        .join(name);
    let raw = fs::read_to_string(path).expect("read fixture");
    serde_json::from_str(&raw).expect("parse fixture")
}

fn events_from_fixture(name: &str) -> Vec<AgentEvent> {
    let doc = fixture(name);
    let arr = doc.get("events").and_then(|v| v.as_array()).expect("events");
    arr.iter()
        .map(|v| serde_json::from_value(v.clone()).expect("AgentEvent"))
        .collect()
}

#[test]
fn replay_codex_prompt_fixture_contract() {
    let events = events_from_fixture("codex_prompt.json");
    assert_prompt_turn_contract(&events, Some("ok"));
}

#[test]
fn replay_codex_cancel_fixture_contract() {
    let events = events_from_fixture("codex_cancel.json");
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::TurnCompleted { status: TurnStatus::Cancelled, .. }))
    );
}

#[test]
fn replay_codex_approval_fixture_contract() {
    let events = events_from_fixture("codex_approval_deny.json");
    assert_approval_flow_contract(&events);
}

#[test]
fn replay_opencode_prompt_fixture_contract() {
    let events = events_from_fixture("opencode_prompt.json");
    assert_prompt_turn_contract(&events, Some("ok"));
}

#[test]
fn replay_opencode_cancel_fixture_contract() {
    let events = events_from_fixture("opencode_cancel.json");
    loomria_app_lib::protocol::assert_no_error_events(&events);
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::TurnCompleted { status: TurnStatus::Cancelled, .. }))
    );
}

#[test]
fn replay_opencode_approval_fixture_contract() {
    let events = events_from_fixture("opencode_approval_deny.json");
    assert_approval_flow_contract(&events);
}

#[test]
fn replay_claude_prompt_fixture_contract() {
    let events = events_from_fixture("claude_prompt.json");
    assert_prompt_turn_contract(&events, Some("ok"));
}

#[test]
fn replay_opencode_mapper_prompt_sequence() {
    let session_id = "ses_test";
    let counter = Arc::new(AtomicU64::new(1));
    let inputs = [
        serde_json::json!({"type":"message.part.updated","properties":{"sessionID":session_id,"part":{"type":"text","text":"ok","messageID":"m1","done":false}}}),
        serde_json::json!({"type":"message.part.updated","properties":{"sessionID":session_id,"part":{"type":"text","text":"ok","messageID":"m1","done":true}}}),
        serde_json::json!({"type":"session.status","properties":{"sessionID":session_id,"status":"idle"}}),
    ];
    let mut events = vec![AgentEvent::TurnStarted {
        turn_id: "1".into(),
    }];
    for input in inputs {
        events.extend(map_opencode_event(&input, session_id, &counter));
    }
    assert_prompt_turn_contract(&events, Some("ok"));
}

#[test]
fn replay_opencode_mapper_approval_sequence() {
    let session_id = "ses_test";
    let counter = Arc::new(AtomicU64::new(1));
    let mut events = vec![AgentEvent::TurnStarted {
        turn_id: "1".into(),
    }];
    events.extend(map_opencode_event(
        &serde_json::json!({"type":"permission.asked","properties":{"sessionID":session_id,"id":"perm1","type":"bash","pattern":"echo hi"}}),
        session_id,
        &counter,
    ));
    events.push(AgentEvent::ApprovalResolved {
        approval_id: "perm1".into(),
        decision: loomria_app_lib::protocol::ApprovalDecision::Deny,
    });
    events.extend(map_opencode_event(
        &serde_json::json!({"type":"session.status","properties":{"sessionID":session_id,"status":"idle"}}),
        session_id,
        &counter,
    ));
    assert_approval_flow_contract(&events);
}

#[test]
fn replay_codex_mapper_approval_and_complete() {
    let counter = AtomicU64::new(1);
    let active = Mutex::new(None);
    let mut events = vec![AgentEvent::TurnStarted {
        turn_id: "1".into(),
    }];
    events.extend(map_codex_server_request(
        &serde_json::json!({"id":"99","method":"item/commandExecution/requestApproval","params":{"command":"echo hi"}}),
        &counter,
    ));
    events.push(AgentEvent::ApprovalResolved {
        approval_id: "99".into(),
        decision: loomria_app_lib::protocol::ApprovalDecision::Deny,
    });
    events.extend(map_codex_notification(
        &serde_json::json!({"method":"turn/completed","params":{"turn":{"id":"1","status":"completed"}}}),
        &counter,
        &active,
    ));
    assert_approval_flow_contract(&events);
}

#[test]
fn replay_claude_mapper_ok_sequence() {
    let counter = Arc::new(AtomicU64::new(1));
    let mut mapper = ClaudeStreamMapper::default();
    mapper.begin_turn();
    let mut events = vec![AgentEvent::TurnStarted {
        turn_id: "1".into(),
    }];
    events.extend(mapper.push_line(
        r#"{"type":"assistant","uuid":"m1","message":{"content":[{"type":"text","text":"ok"}]}}"#,
        &counter,
    ));
    events.extend(mapper.push_line(
        r#"{"type":"result","usage":{"input_tokens":1,"output_tokens":1}}"#,
        &counter,
    ));
    assert_prompt_turn_contract(&events, Some("ok"));
    assert!(matches!(
        events.last(),
        Some(AgentEvent::TurnCompleted { .. })
    ));
}
