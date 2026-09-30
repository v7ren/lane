//! Live check against a real `codex app-server` (two tiny prompts at most).
//! Run: `cargo test --test codex_ws_live -- --ignored --nocapture`
#![cfg(feature = "codex-ws")]

use loomria_app_lib::agents::ProtocolKind;
use loomria_app_lib::protocol::{adapter_for, AgentEvent, Endpoint, MessageRole};
use serde_json::{json, Value};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tungstenite::{connect, stream::MaybeTlsStream, Message, WebSocket};

struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn free_port() -> u16 {
    (5300..5400)
        .find(|p| TcpListener::bind(("127.0.0.1", *p)).is_ok())
        .expect("free port")
}

fn rpc(ws: &mut WebSocket<MaybeTlsStream<TcpStream>>, id: u64, method: &str, params: Value) -> Value {
    ws.send(Message::Text(
        json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}).to_string(),
    ))
    .unwrap();
    loop {
        if let Message::Text(t) = ws.read().unwrap() {
            let v: Value = serde_json::from_str(&t).unwrap();
            if v.get("id") == Some(&json!(id)) {
                return v;
            }
        }
    }
}

fn raw_client(url: &str) -> WebSocket<MaybeTlsStream<TcpStream>> {
    let mut ws = connect(url).expect("connect").0;
    let r = rpc(&mut ws, 1, "initialize", json!({"clientInfo":{"name":"loomria","version":"0"}}));
    assert!(r.get("result").is_some(), "{r}");
    ws.send(Message::Text(json!({"jsonrpc":"2.0","method":"initialized"}).to_string()))
        .unwrap();
    ws
}

fn wait_agent_message(rx: &mut tokio::sync::broadcast::Receiver<AgentEvent>) -> Vec<AgentEvent> {
    let deadline = Instant::now() + Duration::from_secs(120);
    let mut out = Vec::new();
    while Instant::now() < deadline {
        match rx.try_recv() {
            Ok(e) => {
                let done = matches!(e, AgentEvent::TurnCompleted { .. });
                if matches!(e, AgentEvent::Error { .. }) {
                    panic!("error event: {e:?}");
                }
                out.push(e);
                if done {
                    return out;
                }
            }
            Err(_) => std::thread::sleep(Duration::from_millis(25)),
        }
    }
    panic!("timeout; events: {out:?}");
}

fn prompt(url: &str, thread: Option<String>, cwd: &str) -> Vec<AgentEvent> {
    let session = adapter_for(ProtocolKind::CodexAppServer)
        .unwrap()
        .connect(Endpoint {
            url: url.to_string(),
            session_id: thread,
            cwd: Some(cwd.to_string()),
            codex: None,
            connect_pane_id: None,
        })
        .expect("connect");
    let mut rx = session.subscribe();
    let deadline = Instant::now() + Duration::from_secs(30);
    while session.send_prompt("Reply with exactly the word ok".into()).is_err() {
        assert!(Instant::now() < deadline, "thread never ready");
        std::thread::sleep(Duration::from_millis(50));
    }
    wait_agent_message(&mut rx)
}

#[test]
#[ignore = "live codex"]
fn live_handshake_thread_roundtrip() {
    let tmp = std::env::temp_dir().join("loomria-ws-live");
    std::fs::create_dir_all(&tmp).unwrap();
    let cwd = tmp.to_string_lossy().to_string();
    let port = free_port();
    let url = format!("ws://127.0.0.1:{port}");
    let exe = loomria_app_lib::shell_env::resolve_codex_executable().expect("codex on PATH");
    let _server = Server(
        Command::new(exe)
            .args(["app-server", "--listen", &url])
            .current_dir(&tmp)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn codex"),
    );
    let deadline = Instant::now() + Duration::from_secs(30);
    while TcpStream::connect(("127.0.0.1", port)).is_err() {
        assert!(Instant::now() < deadline, "server did not come up");
        std::thread::sleep(Duration::from_millis(200));
    }

    // 1. dual-pane flow (mirrors `start_thread_blocking`): thread/start, then
    //    thread/name/set to persist the rollout, close, resume on a new socket.
    //    A never-used thread cannot be resumed ("no rollout found") without name/set.
    let mut a = raw_client(&url);
    let started = rpc(&mut a, 2, "thread/start", json!({"cwd": cwd}));
    let thread_id = started["result"]["thread"]["id"].as_str().expect("thread id").to_string();
    let named = rpc(&mut a, 3, "thread/name/set", json!({"threadId": thread_id, "name": "Loomria"}));
    assert!(named.get("result").is_some(), "{named}");
    let _ = a.close(None);
    drop(a);
    let mut b = raw_client(&url);
    let resumed = rpc(&mut b, 2, "thread/resume", json!({"threadId": thread_id, "cwd": cwd}));
    println!("resume after close -> has result: {}", resumed.get("result").is_some());
    let resumed_ok = resumed.get("result").is_some();
    let _ = b.close(None);
    drop(b);

    // 2. adapter path: resume the same id and run a real (tiny) turn.
    let events = if resumed_ok {
        prompt(&url, Some(thread_id.clone()), &cwd)
    } else {
        prompt(&url, None, &cwd)
    };
    let user = events
        .iter()
        .position(|e| matches!(e, AgentEvent::MessageCompleted { role: MessageRole::User, .. }));
    let agent = events.iter().any(|e| {
        matches!(e, AgentEvent::MessageDelta { role: MessageRole::Assistant, .. }
            | AgentEvent::MessageCompleted { role: MessageRole::Assistant, .. })
    });
    let ts = events.iter().position(|e| matches!(e, AgentEvent::TurnStarted { .. }));
    println!("resumed_ok={resumed_ok} user_idx={user:?} turn_started_idx={ts:?} agent_message={agent}");
    assert!(resumed_ok, "thread/resume of a fresh thread failed: {resumed}");
    assert!(user.is_some() && agent, "{events:?}");
}
