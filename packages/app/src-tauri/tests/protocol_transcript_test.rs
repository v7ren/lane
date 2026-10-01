use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn fixture(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name);
    let raw = fs::read_to_string(path).expect("read fixture");
    serde_json::from_str(&raw).expect("parse fixture")
}

#[test]
fn agent_event_contract_fixture_matches_rust() {
    let sample = loomria_app_lib::protocol::AgentEvent::TurnStarted {
        turn_id: "t1".into(),
    };
    let json = serde_json::to_value(&sample).expect("serialize");
    assert_eq!(json.get("type").and_then(|v| v.as_str()), Some("turn_started"));
}

/// Minimal JSON for each fixture type name (snake_case wire contract, same as the TS test).
fn sample_event_json(ty: &str) -> Value {
    match ty {
        "turn_started" => serde_json::json!({"type":"turn_started","turn_id":"t"}),
        "message_delta" => serde_json::json!({"type":"message_delta","turn_id":"t","message_id":"m1","role":"assistant","text":"x"}),
        "turn_completed" => serde_json::json!({"type":"turn_completed","turn_id":"t","status":"ok"}),
        "approval_requested" => serde_json::json!({"type":"approval_requested","approval_id":"a1","title":"Run","detail":"cmd","kind":"command","options":["allow_once","deny"]}),
        "approval_resolved" => serde_json::json!({"type":"approval_resolved","approval_id":"a1","decision":"deny"}),
        "notice" => serde_json::json!({"type":"notice","id":"n1","level":"info","text":"hi"}),
        "plan_updated" => serde_json::json!({"type":"plan_updated","items":[{"text":"a","status":"in_progress"}]}),
        other => panic!("fixture type {other} has no sample in this test"),
    }
}

#[test]
fn every_fixture_event_type_deserializes_and_round_trips() {
    let sequences = fixture("agent_event_sequences.json");
    for (name, types) in sequences.as_object().expect("object") {
        for ty in types.as_array().expect("array") {
            let ty = ty.as_str().expect("string");
            let json = sample_event_json(ty);
            let event: loomria_app_lib::protocol::AgentEvent = serde_json::from_value(json)
                .unwrap_or_else(|e| panic!("{name}/{ty} does not deserialize: {e}"));
            let back = serde_json::to_value(&event).expect("serialize");
            assert_eq!(back.get("type").and_then(|v| v.as_str()), Some(ty), "{name}");
        }
    }
    assert!(sequences.get("claude_notice_and_plan").is_some());
}

#[test]
fn expected_sequences_are_non_empty() {
    let sequences = fixture("agent_event_sequences.json");
    for key in ["codex_prompt_ok", "opencode_prompt_ok", "claude_prompt_ok"] {
        let seq = sequences.get(key).and_then(|v| v.as_array()).expect("array");
        assert!(seq.len() >= 3, "{key} should list at least 3 event types");
    }
}
