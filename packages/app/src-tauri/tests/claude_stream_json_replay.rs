//! Replays a real (sanitized) `claude -p --output-format stream-json --include-partial-messages`
//! capture through `ClaudeStreamMapper`. Fixture: `tests/fixtures/claude_raw_turns.jsonl`
//! (two prompts back to back; each capture ends at its `result` line).

use loomria_app_lib::protocol::claude_stream_json::ClaudeStreamMapper;
use loomria_app_lib::protocol::{AgentEvent, ToolStatus, TurnStatus};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

fn captures() -> Vec<Vec<String>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/claude_raw_turns.jsonl");
    let raw = fs::read_to_string(path).expect("read fixture");
    let mut out: Vec<Vec<String>> = vec![Vec::new()];
    for line in raw.lines().filter(|l| !l.trim().is_empty()) {
        let is_result = serde_json::from_str::<serde_json::Value>(line)
            .ok()
            .and_then(|v| v.get("type").and_then(|t| t.as_str()).map(|t| t == "result"))
            .unwrap_or(false);
        out.last_mut().unwrap().push(line.to_string());
        if is_result {
            out.push(Vec::new());
        }
    }
    // Trailing lines after the last result (e.g. task_summary) start a bogus capture; drop
    // empties but keep them attached to a capture that has a result, so the mapper must ignore them.
    let trailing = out.pop().unwrap_or_default();
    if !trailing.is_empty() {
        out.last_mut().unwrap().extend(trailing);
    }
    out
}

fn replay(lines: &[String], turn: u64) -> Vec<AgentEvent> {
    let counter = Arc::new(AtomicU64::new(turn));
    let mut mapper = ClaudeStreamMapper::default();
    mapper.begin_turn();
    lines
        .iter()
        .flat_map(|l| mapper.push_line(l, &counter))
        .collect()
}

fn label(e: &AgentEvent) -> String {
    match e {
        AgentEvent::MessageDelta { text, content_kind, text_mode, .. } => {
            format!("delta:{content_kind:?}:{text_mode:?}:{text}")
        }
        AgentEvent::MessageCompleted { text, .. } => format!("completed:{text}"),
        AgentEvent::ToolStarted { name, .. } => format!("tool_started:{name}"),
        AgentEvent::ToolCompleted { status, .. } => format!("tool_completed:{status:?}"),
        AgentEvent::Usage { cost_usd, .. } => format!("usage:cost={}", cost_usd.is_some()),
        AgentEvent::TurnCompleted { status, .. } => format!("turn_completed:{status:?}"),
        other => format!("other:{other:?}"),
    }
}

#[test]
fn fixture_has_two_captures() {
    assert_eq!(captures().len(), 2);
}

#[test]
fn simple_reply_capture() {
    let caps = captures();
    let events = replay(&caps[0], 1);
    let labels: Vec<String> = events.iter().map(label).collect();
    assert_eq!(
        labels,
        vec![
            "delta:Text:Replace:ok",
            "completed:ok",
            "usage:cost=true",
            "turn_completed:Ok",
        ]
    );
    // Streamed delta and the final assistant message share one id (no duplicated text).
    let (AgentEvent::MessageDelta { message_id: d, .. }, AgentEvent::MessageCompleted { message_id: c, .. }) =
        (&events[0], &events[1])
    else {
        panic!("unexpected shape");
    };
    assert_eq!(d, c);
    assert!(d.starts_with("msg_"), "id from stream, got {d}");
    if let AgentEvent::Usage { cost_usd, output_tokens, .. } = &events[2] {
        assert!(cost_usd.unwrap() > 0.0);
        assert_eq!(*output_tokens, Some(4));
    }
}

#[test]
fn tool_use_capture() {
    let caps = captures();
    let events = replay(&caps[1], 2);
    let labels: Vec<String> = events.iter().map(label).collect();
    assert_eq!(
        labels,
        vec![
            "tool_started:Read",
            "tool_completed:Ok",
            "delta:Text:Replace:Hi",
            "completed:Hi",
            "usage:cost=true",
            "turn_completed:Ok",
        ]
    );
    let AgentEvent::ToolStarted { tool_id, input_summary, turn_id, .. } = &events[0] else {
        panic!()
    };
    assert!(tool_id.starts_with("toolu_"));
    assert!(input_summary.contains("hello.txt"));
    assert_eq!(turn_id, "2");
    let AgentEvent::ToolCompleted { tool_id: done_id, output_summary, status, .. } = &events[1] else {
        panic!()
    };
    assert_eq!(done_id, tool_id);
    assert_eq!(*status, ToolStatus::Ok);
    assert!(output_summary.contains("hi"));
}

#[test]
fn message_ids_are_unique_across_captures() {
    let caps = captures();
    let mut ids = Vec::new();
    for (i, cap) in caps.iter().enumerate() {
        for e in replay(cap, i as u64 + 1) {
            if let AgentEvent::MessageCompleted { message_id, .. } = e {
                ids.push(message_id);
            }
        }
    }
    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
    assert!(ids.iter().all(|i| i != "assistant"));
}

#[test]
fn unknown_and_garbage_lines_do_not_panic() {
    let counter = Arc::new(AtomicU64::new(1));
    let mut mapper = ClaudeStreamMapper::default();
    mapper.begin_turn();
    for line in [
        "",
        "not json",
        r#"{"type":"brand_new_type","x":1}"#,
        r#"{"type":"stream_event","event":{"type":"surprise"}}"#,
        r#"{"type":"system","subtype":"init"}"#,
        r#"{"type":"user","message":{"content":"plain string"}}"#,
    ] {
        assert!(mapper.push_line(line, &counter).is_empty(), "{line}");
    }
}

#[test]
fn tool_result_is_error_maps_to_error_status() {
    let counter = Arc::new(AtomicU64::new(1));
    let mut mapper = ClaudeStreamMapper::default();
    mapper.begin_turn();
    let events = mapper.push_line(
        r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_x","is_error":true,"content":"boom"}]}}"#,
        &counter,
    );
    assert!(matches!(
        events.as_slice(),
        [AgentEvent::ToolCompleted { status: ToolStatus::Error, output_summary, .. }] if output_summary == "boom"
    ));
}

#[test]
fn error_result_sets_turn_status_error() {
    let counter = Arc::new(AtomicU64::new(1));
    let mut mapper = ClaudeStreamMapper::default();
    mapper.begin_turn();
    let events = mapper.push_line(
        r#"{"type":"result","subtype":"error_during_execution","is_error":true,"result":"it broke","total_cost_usd":0.5,"usage":{"input_tokens":1,"output_tokens":1}}"#,
        &counter,
    );
    assert!(matches!(
        events.last(),
        Some(AgentEvent::TurnCompleted { status: TurnStatus::Error, error: Some(e), .. }) if e == "it broke"
    ));
    assert!(events.iter().any(|e| matches!(e, AgentEvent::Error { .. })));
    assert!(events
        .iter()
        .any(|e| matches!(e, AgentEvent::Usage { cost_usd: Some(c), .. } if *c == 0.5)));
}

#[test]
fn streamed_thinking_then_text_uses_distinct_ids() {
    let counter = Arc::new(AtomicU64::new(1));
    let mut mapper = ClaudeStreamMapper::default();
    mapper.begin_turn();
    let lines = [
        r#"{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_a"}}}"#,
        r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}}"#,
        r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hm"}}}"#,
        r#"{"type":"assistant","message":{"id":"msg_a","content":[{"type":"thinking","thinking":"hm"}]}}"#,
        r#"{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}}"#,
        r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"a"}}}"#,
        r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"b"}}}"#,
        r#"{"type":"assistant","message":{"id":"msg_a","content":[{"type":"text","text":"ab"}]}}"#,
    ];
    let events: Vec<AgentEvent> = lines.iter().flat_map(|l| mapper.push_line(l, &counter)).collect();
    let labels: Vec<String> = events.iter().map(label).collect();
    assert_eq!(
        labels,
        vec![
            "delta:Reasoning:Replace:hm",
            "completed:hm",
            "delta:Text:Replace:a",
            "delta:Text:Replace:ab",
            "completed:ab",
        ]
    );
    let ids: Vec<&str> = events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::MessageCompleted { message_id, .. } => Some(message_id.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(ids, vec!["msg_a:thinking:0", "msg_a"]);
}
