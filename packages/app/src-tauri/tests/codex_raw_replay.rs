//! Replays a real `codex app-server` capture (codex-cli 0.159, sanitized) through the mapper.

use loomria_app_lib::protocol::codex_notifications::map_codex_notification;
use loomria_app_lib::protocol::{
    AgentEvent, MessageContentKind, MessageRole, MessageTextMode, ToolStatus, TurnStatus,
};
use parking_lot::Mutex;
use serde_json::Value;
use std::sync::atomic::AtomicU64;

const RAW: &str = include_str!("fixtures/codex_raw_turns.jsonl");

/// Map every inbound notification; returns events grouped per server turn (TURN_n).
fn replay() -> Vec<AgentEvent> {
    let counter = AtomicU64::new(1);
    let active: Mutex<Option<String>> = Mutex::new(None);
    let mut events = Vec::new();
    for line in RAW.lines().filter(|l| !l.trim().is_empty()) {
        let rec: Value = serde_json::from_str(line).expect("fixture line is json");
        if rec["dir"] != "in" || rec["msg"].get("method").is_none() {
            continue;
        }
        events.extend(map_codex_notification(&rec["msg"], &counter, &active));
    }
    events
}

fn turn_events(events: &[AgentEvent], turn: &str) -> Vec<AgentEvent> {
    let mut out = Vec::new();
    let mut inside = false;
    for e in events {
        if let AgentEvent::TurnStarted { turn_id } = e {
            inside = turn_id == turn;
        }
        if inside {
            out.push(e.clone());
        }
        if inside && matches!(e, AgentEvent::TurnCompleted { .. }) {
            break;
        }
    }
    out
}

fn turn_id_of(e: &AgentEvent) -> Option<&str> {
    match e {
        AgentEvent::TurnStarted { turn_id }
        | AgentEvent::MessageDelta { turn_id, .. }
        | AgentEvent::MessageCompleted { turn_id, .. }
        | AgentEvent::ToolStarted { turn_id, .. }
        | AgentEvent::ToolCompleted { turn_id, .. }
        | AgentEvent::TurnCompleted { turn_id, .. } => Some(turn_id),
        _ => None,
    }
}

#[test]
fn ok_turn_sequence() {
    let events = replay();
    let t1 = turn_events(&events, "TURN_1");
    assert!(matches!(t1.first(), Some(AgentEvent::TurnStarted { .. })));
    match &t1[1] {
        AgentEvent::MessageDelta { text, role, content_kind, text_mode, .. } => {
            assert_eq!(text, "ok");
            assert_eq!(*role, MessageRole::Assistant);
            assert_eq!(*content_kind, MessageContentKind::Text);
            assert_eq!(*text_mode, MessageTextMode::Append);
        }
        other => panic!("expected delta, got {other:?}"),
    }
    assert!(matches!(&t1[2], AgentEvent::MessageCompleted { text, .. } if text == "ok"));
    assert!(matches!(
        &t1[3],
        AgentEvent::Usage { input_tokens: Some(24613), output_tokens: Some(5), .. }
    ));
    assert!(matches!(
        t1.last(),
        Some(AgentEvent::TurnCompleted { status: TurnStatus::Ok, error: None, .. })
    ));
    assert_eq!(t1.len(), 5, "{t1:?}");
}

#[test]
fn echo_turn_has_tool_events_and_usage() {
    let events = replay();
    let t2 = turn_events(&events, "TURN_2");
    let started = t2
        .iter()
        .find_map(|e| match e {
            AgentEvent::ToolStarted { tool_id, name, input_summary, .. } => {
                Some((tool_id.clone(), name.clone(), input_summary.clone()))
            }
            _ => None,
        })
        .expect("tool_started");
    assert_eq!(started.1, "command");
    assert_eq!(started.2, "echo hi");
    let completed = t2
        .iter()
        .find_map(|e| match e {
            AgentEvent::ToolCompleted { tool_id, status, output_summary, tool_state, .. } => {
                Some((tool_id.clone(), *status, output_summary.clone(), tool_state.clone()))
            }
            _ => None,
        })
        .expect("tool_completed");
    assert_eq!(completed.0, started.0);
    assert_eq!(completed.1, ToolStatus::Ok);
    assert_eq!(completed.2, "hi");
    assert_eq!(completed.3.as_deref(), Some("completed"));

    // Appended deltas reassemble into the commentary message.
    let commentary: String = t2
        .iter()
        .filter_map(|e| match e {
            AgentEvent::MessageDelta { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert!(commentary.starts_with("I\u{2019}ll run `echo hi`."), "{commentary}");
    assert!(t2.iter().any(|e| matches!(e, AgentEvent::Usage { .. })));
    assert!(matches!(
        t2.last(),
        Some(AgentEvent::TurnCompleted { status: TurnStatus::Ok, .. })
    ));
}

#[test]
fn every_event_of_a_turn_shares_the_server_turn_id() {
    let events = replay();
    for turn in ["TURN_1", "TURN_2", "TURN_3"] {
        let evs = turn_events(&events, turn);
        assert!(!evs.is_empty(), "{turn} missing");
        for e in &evs {
            if let Some(id) = turn_id_of(e) {
                assert_eq!(id, turn, "{e:?}");
            }
        }
    }
}

#[test]
fn unknown_and_noise_methods_are_dropped() {
    let counter = AtomicU64::new(1);
    let active: Mutex<Option<String>> = Mutex::new(None);
    for m in ["thread/status/changed", "skills/changed", "item/commandExecution/outputDelta", "made/up"] {
        let v = serde_json::json!({"method": m, "params": {"threadId": "THREAD_ID"}});
        assert!(map_codex_notification(&v, &counter, &active).is_empty(), "{m}");
    }
    let weird = serde_json::json!({"method": 5});
    assert!(map_codex_notification(&weird, &counter, &active).is_empty());
}
