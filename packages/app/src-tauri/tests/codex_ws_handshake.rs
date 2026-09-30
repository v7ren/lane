//! Loopback fake Codex app-server: asserts the JSON-RPC handshake order, server-allocated
//! thread id usage and the synthetic user-prompt events (shapes from
//! `tests/fixtures/codex_raw_turns.jsonl`, real Codex 0.159).
#![cfg(feature = "codex-ws")]

use loomria_app_lib::agents::ProtocolKind;
use loomria_app_lib::protocol::{
    adapter_for, AgentEvent, Endpoint, MessageRole, ProtocolSession,
};
use parking_lot::Mutex;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tungstenite::{accept, Message};

const SERVER_THREAD: &str = "thr-from-server";

type Log = Arc<Mutex<Vec<Value>>>;

/// Serves one client. Responses deliberately omit `"jsonrpc"` like real Codex.
fn spawn_fake_server() -> (String, Log) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    let log: Log = Arc::new(Mutex::new(Vec::new()));
    let log_srv = Arc::clone(&log);
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept");
        let mut ws = accept(stream).expect("ws accept");
        loop {
            let msg = match ws.read() {
                Ok(Message::Text(t)) => t,
                Ok(Message::Close(_)) | Err(_) => break,
                Ok(_) => continue,
            };
            let v: Value = serde_json::from_str(&msg).unwrap();
            log_srv.lock().push(v.clone());
            let id = v.get("id").cloned();
            let send = |ws: &mut tungstenite::WebSocket<std::net::TcpStream>, v: Value| {
                ws.send(Message::Text(v.to_string())).unwrap();
            };
            match v.get("method").and_then(|m| m.as_str()) {
                Some("initialize") => send(
                    &mut ws,
                    json!({"id": id, "result": {"userAgent": "fake/0.159.0"}}),
                ),
                Some("thread/start") => {
                    // Real Codex: no client thread id; the server allocates it.
                    send(
                        &mut ws,
                        json!({"id": id, "result": {"thread": {"id": SERVER_THREAD}}}),
                    );
                    send(
                        &mut ws,
                        json!({"method": "thread/started", "params": {"thread": {"id": SERVER_THREAD}}}),
                    );
                }
                Some("thread/resume") => send(
                    &mut ws,
                    json!({"id": id, "result": {"thread": {"id": v["params"]["threadId"]}}}),
                ),
                Some("turn/start") => {
                    send(
                        &mut ws,
                        json!({"id": id, "result": {"turn": {"id": "TURN_1", "items": [], "status": "inProgress"}}}),
                    );
                    send(
                        &mut ws,
                        json!({"method": "turn/started", "params": {"threadId": v["params"]["threadId"], "turn": {"id": "TURN_1", "status": "inProgress"}}}),
                    );
                    send(
                        &mut ws,
                        json!({"method": "item/agentMessage/delta", "params": {"threadId": v["params"]["threadId"], "turnId": "TURN_1", "itemId": "ITEM_2", "delta": "ok"}}),
                    );
                    send(
                        &mut ws,
                        json!({"method": "turn/completed", "params": {"threadId": v["params"]["threadId"], "turn": {"id": "TURN_1", "status": "completed", "items": []}}}),
                    );
                }
                _ => {}
            }
        }
    });
    (format!("ws://127.0.0.1:{port}"), log)
}

fn connect(url: String, session_id: Option<String>) -> Box<dyn ProtocolSession> {
    adapter_for(ProtocolKind::CodexAppServer)
        .expect("codex adapter")
        .connect(Endpoint {
            url,
            session_id,
            cwd: Some(std::env::temp_dir().to_string_lossy().to_string()),
            codex: None,
            connect_pane_id: None,
        })
        .expect("connect")
}

fn send_when_ready(session: &dyn ProtocolSession, text: &str) {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match session.send_prompt(text.to_string()) {
            Ok(()) => return,
            Err(e) if Instant::now() < deadline => {
                let _ = e;
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(e) => panic!("send_prompt never became ready: {e}"),
        }
    }
}

fn collect_until_turn_completed(
    rx: &mut tokio::sync::broadcast::Receiver<AgentEvent>,
) -> Vec<AgentEvent> {
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut out = Vec::new();
    while Instant::now() < deadline {
        match rx.try_recv() {
            Ok(ev) => {
                let done = matches!(ev, AgentEvent::TurnCompleted { .. });
                out.push(ev);
                if done {
                    return out;
                }
            }
            Err(_) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    panic!("timed out; events so far: {out:?}");
}

fn methods(log: &Log) -> Vec<String> {
    log.lock()
        .iter()
        .filter_map(|v| v.get("method").and_then(|m| m.as_str()).map(String::from))
        .collect()
}

#[test]
fn handshake_order_thread_id_and_user_events() {
    let (url, log) = spawn_fake_server();
    let session = connect(url, None);
    let mut rx = session.subscribe();
    send_when_ready(session.as_ref(), "Reply with exactly the word ok");
    let events = collect_until_turn_completed(&mut rx);

    // initialize -> initialized -> thread/start -> turn/start
    assert_eq!(
        methods(&log),
        vec!["initialize", "initialized", "thread/start", "turn/start"]
    );
    let log = log.lock();
    let init = &log[1];
    assert!(init.get("id").is_none(), "initialized is a notification: {init}");
    let start = &log[2];
    assert!(
        start["params"].get("threadId").is_none(),
        "thread/start must not carry a threadId: {start}"
    );
    assert!(start["params"]["cwd"].is_string());
    let turn = &log[3];
    assert_eq!(turn["params"]["threadId"], SERVER_THREAD);
    assert_eq!(turn["params"]["input"][0]["text"], "Reply with exactly the word ok");

    // user message events carry role=user, the prompt text, and come before TurnStarted.
    let first_user = events
        .iter()
        .position(|e| matches!(e, AgentEvent::MessageDelta { role: MessageRole::User, .. }))
        .expect("user MessageDelta");
    let user_done = events
        .iter()
        .position(|e| matches!(e, AgentEvent::MessageCompleted { role: MessageRole::User, .. }))
        .expect("user MessageCompleted");
    let turn_started = events
        .iter()
        .position(|e| matches!(e, AgentEvent::TurnStarted { .. }))
        .expect("TurnStarted");
    assert!(first_user < user_done && user_done < turn_started, "{events:?}");
    match (&events[first_user], &events[user_done]) {
        (
            AgentEvent::MessageDelta { turn_id: t1, message_id: m1, text: x1, .. },
            AgentEvent::MessageCompleted { turn_id: t2, message_id: m2, text: x2, .. },
        ) => {
            assert_eq!(t1, "TURN_1");
            assert_eq!(t1, t2);
            assert_eq!(m1, m2);
            assert_eq!(x1, "Reply with exactly the word ok");
            assert_eq!(x1, x2);
        }
        _ => unreachable!(),
    }
    match &events[turn_started] {
        AgentEvent::TurnStarted { turn_id } => assert_eq!(turn_id, "TURN_1"),
        _ => unreachable!(),
    }
    assert!(events.iter().any(
        |e| matches!(e, AgentEvent::MessageDelta { role: MessageRole::Assistant, text, .. } if text == "ok")
    ));
}

#[test]
fn existing_thread_is_resumed_not_started() {
    let (url, log) = spawn_fake_server();
    let session = connect(url, Some("thr-existing".into()));
    let mut rx = session.subscribe();
    send_when_ready(session.as_ref(), "hi");
    collect_until_turn_completed(&mut rx);
    assert_eq!(
        methods(&log),
        vec!["initialize", "initialized", "thread/resume", "turn/start"]
    );
    let log = log.lock();
    assert_eq!(log[2]["params"]["threadId"], "thr-existing");
    assert_eq!(log[3]["params"]["threadId"], "thr-existing");
}
