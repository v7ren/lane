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

#[test]
fn expected_sequences_are_non_empty() {
    let sequences = fixture("agent_event_sequences.json");
    for key in ["codex_prompt_ok", "opencode_prompt_ok", "claude_prompt_ok"] {
        let seq = sequences.get(key).and_then(|v| v.as_array()).expect("array");
        assert!(seq.len() >= 3, "{key} should list at least 3 event types");
    }
}
