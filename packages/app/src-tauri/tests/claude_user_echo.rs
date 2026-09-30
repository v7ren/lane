//! Claude never echoes the prompt; `send_prompt` must emit the user turn itself.
//! (`send_prompt` calls `emit_user_prompt_events`, exercised here without a claude binary.)

use loomria_app_lib::protocol::claude_stream_json::emit_user_prompt_events;
use loomria_app_lib::protocol::{AgentEvent, MessageContentKind, MessageRole};
use tokio::sync::broadcast;

#[test]
fn send_prompt_echo_emits_turn_started_then_user_message() {
    let (tx, mut rx) = broadcast::channel(16);
    emit_user_prompt_events(&tx, "7", "hello claude");
    let events: Vec<AgentEvent> = std::iter::from_fn(|| rx.try_recv().ok()).collect();
    assert_eq!(events.len(), 3, "{events:?}");
    assert!(matches!(&events[0], AgentEvent::TurnStarted { turn_id } if turn_id == "7"));
    let (delta_id, done_id) = match (&events[1], &events[2]) {
        (
            AgentEvent::MessageDelta { turn_id, message_id, role, text, content_kind, .. },
            AgentEvent::MessageCompleted { turn_id: t2, message_id: m2, role: r2, text: x2, .. },
        ) => {
            assert_eq!(turn_id, "7");
            assert_eq!(t2, "7");
            assert_eq!(*role, MessageRole::User);
            assert_eq!(*r2, MessageRole::User);
            assert_eq!(text, "hello claude");
            assert_eq!(x2, "hello claude");
            assert_eq!(*content_kind, MessageContentKind::Text);
            (message_id.clone(), m2.clone())
        }
        other => panic!("unexpected events: {other:?}"),
    };
    assert_eq!(delta_id, done_id);
}

#[test]
fn user_message_ids_are_unique_per_prompt() {
    let (tx, mut rx) = broadcast::channel(16);
    emit_user_prompt_events(&tx, "1", "a");
    emit_user_prompt_events(&tx, "1", "a");
    let ids: Vec<String> = std::iter::from_fn(|| rx.try_recv().ok())
        .filter_map(|e| match e {
            AgentEvent::MessageCompleted { message_id, .. } => Some(message_id),
            _ => None,
        })
        .collect();
    assert_eq!(ids.len(), 2);
    assert_ne!(ids[0], ids[1]);
}
