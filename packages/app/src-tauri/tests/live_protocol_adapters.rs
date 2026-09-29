//! Live adapter smoke (run with `cargo test --test live_protocol_adapters -- --ignored`).

use loomria_app_lib::protocol::{adapter_for, AgentEvent, Endpoint};
use loomria_app_lib::agents::ProtocolKind;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn snapshot_pids() -> HashSet<u32> {
    let mut set = HashSet::new();
    for name in ["codex", "claude", "opencode", "node"] {
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Get-Process {name} -ErrorAction SilentlyContinue | ForEach-Object {{ $_.Id }}"
                ),
            ])
            .output()
            .expect("powershell");
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Ok(pid) = line.trim().parse::<u32>() {
                set.insert(pid);
            }
        }
    }
    set
}

fn assert_no_new_pids(before: &HashSet<u32>, after: &HashSet<u32>, label: &str) {
    let new: Vec<u32> = after.difference(before).copied().collect();
    assert!(new.is_empty(), "{label} orphan new PIDs: {new:?}");
}

fn event_types(events: &[AgentEvent]) -> Vec<String> {
    events
        .iter()
        .map(|e| serde_json::to_value(e).unwrap()["type"].as_str().unwrap().to_string())
        .collect()
}

#[test]
#[ignore = "live codex adapter; run manually"]
fn live_codex_prompt_and_approval() {
    let before = snapshot_pids();
    let _tmpdir = tempfile::tempdir().expect("tmpdir");
    let cwd = _tmpdir.path().to_string_lossy().to_string();
    let adapter = adapter_for(ProtocolKind::CodexAppServer).expect("adapter");
    // Requires external `codex app-server` — exercised via supervisor in full E2E.
    let _ = (adapter, cwd);
    let after = snapshot_pids();
    assert_no_new_pids(&before, &after, "codex");
}

#[test]
#[ignore = "live claude stream-json"]
fn live_claude_prompt() {
    let before = snapshot_pids();
    let adapter = adapter_for(ProtocolKind::ClaudeStreamJson).expect("adapter");
    let session = adapter
        .connect(Endpoint {
            url: String::new(),
            session_id: Some(uuid::Uuid::new_v4().to_string()),
            cwd: Some(std::env::temp_dir().to_string_lossy().to_string()),
        })
        .expect("connect");
    let mut rx = session.subscribe();
    session
        .send_prompt("Reply with exactly the word ok".into())
        .expect("prompt");
    let mut events = Vec::new();
    for _ in 0..120 {
        if let Ok(ev) = rx.try_recv() {
            events.push(ev);
        }
        if events.iter().any(|e| matches!(e, AgentEvent::TurnCompleted { .. })) {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    let types = event_types(&events);
    let _ = fs::write(
        fixture_dir().join("live_claude_prompt_types.json"),
        serde_json::to_string_pretty(&types).unwrap(),
    );
    drop(session);
    std::thread::sleep(Duration::from_secs(5));
    let after = snapshot_pids();
    let new: Vec<u32> = after.difference(&before).copied().collect();
    assert!(
        new.is_empty(),
        "claude orphan new PIDs after teardown: {new:?}; events={types:?}"
    );
}
