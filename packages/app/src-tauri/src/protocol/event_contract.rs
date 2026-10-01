//! Shared turn / prompt assertions for live runs and fixture replay.

use super::{AgentEvent, MessageContentKind, MessageRole, TurnStatus};

const TURN_SCOPED: &[&str] = &[
    "turn_started",
    "message_delta",
    "message_completed",
    "tool_started",
    "tool_completed",
    "approval_requested",
    "approval_resolved",
    "turn_completed",
];

fn event_type(event: &AgentEvent) -> &'static str {
    match event {
        AgentEvent::TurnStarted { .. } => "turn_started",
        AgentEvent::MessageDelta { .. } => "message_delta",
        AgentEvent::MessageCompleted { .. } => "message_completed",
        AgentEvent::MessageMeta { .. } => "message_meta",
        AgentEvent::ToolStarted { .. } => "tool_started",
        AgentEvent::ToolCompleted { .. } => "tool_completed",
        AgentEvent::ApprovalRequested { .. } => "approval_requested",
        AgentEvent::ApprovalResolved { .. } => "approval_resolved",
        AgentEvent::TurnCompleted { .. } => "turn_completed",
        AgentEvent::Error { .. } => "error",
        AgentEvent::FilesChanged { .. } => "files_changed",
        AgentEvent::Usage { .. } => "usage",
        AgentEvent::RateLimited { .. } => "rate_limited",
        AgentEvent::Notice { .. } => "notice",
        AgentEvent::PlanUpdated { .. } => "plan_updated",
        AgentEvent::ToolOutputDelta { .. } => "tool_output_delta",
    }
}

fn turn_id_of(event: &AgentEvent) -> Option<&str> {
    match event {
        AgentEvent::TurnStarted { turn_id }
        | AgentEvent::MessageDelta { turn_id, .. }
        | AgentEvent::MessageCompleted { turn_id, .. }
        | AgentEvent::ToolStarted { turn_id, .. }
        | AgentEvent::ToolCompleted { turn_id, .. }
        | AgentEvent::ToolOutputDelta { turn_id, .. }
        | AgentEvent::TurnCompleted { turn_id, .. } => Some(turn_id.as_str()),
        AgentEvent::PlanUpdated { turn_id, .. } => turn_id.as_deref(),
        _ => None,
    }
}

pub fn assemble_assistant_text(events: &[AgentEvent]) -> String {
    let mut parts = Vec::new();
    for event in events {
        match event {
            AgentEvent::MessageDelta {
                role,
                text,
                content_kind: MessageContentKind::Text,
                ..
            }
            | AgentEvent::MessageCompleted {
                role,
                text,
                content_kind: MessageContentKind::Text,
                ..
            } if *role == MessageRole::Assistant => {
                parts.push(text.as_str());
            }
            _ => {}
        }
    }
    parts.join("")
}

pub fn latest_turn_id(events: &[AgentEvent]) -> Option<String> {
    events
        .iter()
        .rev()
        .find_map(|e| turn_id_of(e).map(|s| s.to_string()))
}

pub fn assert_no_error_events(events: &[AgentEvent]) {
    let errors: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, AgentEvent::Error { .. }))
        .collect();
    assert!(errors.is_empty(), "unexpected error events: {errors:?}");
}

pub fn assert_turn_completed_is_last_turn_scoped(events: &[AgentEvent], turn_id: &str) {
    let scoped: Vec<(usize, &AgentEvent)> = events
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            TURN_SCOPED.contains(&event_type(e))
                && turn_id_of(e).is_some_and(|tid| tid == turn_id)
        })
        .collect();
    assert!(
        scoped.iter().any(|(_, e)| matches!(e, AgentEvent::TurnCompleted { .. })),
        "turn {turn_id} missing turn_completed"
    );
    let last = scoped.last().expect("scoped events");
    assert!(
        matches!(last.1, AgentEvent::TurnCompleted { .. }),
        "turn {turn_id}: last turn-scoped event must be turn_completed, got {:?}",
        event_type(last.1)
    );
}

pub fn assert_prompt_turn_contract(events: &[AgentEvent], expect_ok_text: Option<&str>) {
    assert_no_error_events(events);
    let turn_id = latest_turn_id(events).expect("turn_id");
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::TurnStarted { .. })),
        "missing turn_started"
    );
    let text = assemble_assistant_text(events);
    if let Some(expected) = expect_ok_text {
        assert!(
            text.to_lowercase().contains(&expected.to_lowercase()),
            "assistant text {:?} should contain {expected:?}",
            text
        );
    }
    assert_turn_completed_is_last_turn_scoped(events, &turn_id);
    if let Some(AgentEvent::TurnCompleted { status, .. }) = events
        .iter()
        .filter(|e| matches!(e, AgentEvent::TurnCompleted { .. }))
        .last()
    {
        assert_eq!(*status, TurnStatus::Ok, "prompt turn should complete ok");
    }
}

pub fn assert_approval_flow_contract(events: &[AgentEvent]) {
    assert_no_error_events(events);
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::ApprovalRequested { .. })),
        "missing approval_requested"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::ApprovalResolved { .. })),
        "missing approval_resolved"
    );
    let turn_id = latest_turn_id(events).expect("turn_id for approval flow");
    assert_turn_completed_is_last_turn_scoped(events, &turn_id);
}

pub fn is_claude_auth_failure_text(text: &str) -> bool {
    let lower = text.to_lowercase();
    [
        "failed to authenticate",
        "oauth session",
        "not logged in",
        "authentication required",
        "invalid api key",
        "please run `claude login`",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}
