//! Live adapter verification against real agent CLIs.
//!
//! Run: `cargo test --manifest-path packages/app/src-tauri/Cargo.toml --test live_protocol_adapters -- --ignored --nocapture --test-threads=1`

mod live_helpers;

use live_helpers::*;
use loomria_app_lib::agents::ProtocolKind;
use loomria_app_lib::protocol::{
    adapter_for, AgentError, AgentEvent, CodexThreadOptions, Endpoint,
};
use loomria_app_lib::session::ProtocolHub;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

const PROMPT_OK: &str = "Reply with exactly the word ok";
const PROMPT_APPROVAL: &str =
    "Run the shell command: echo hi (use the shell tool once, nothing else)";
const PROMPT_CANCEL: &str =
    "Count slowly from 1 to 50, output one number per line with a short pause between each.";

#[test]
#[ignore = "live codex adapter"]
fn live_codex_prompt() {
    let live = CodexLive::spawn(None);
    live.hub
        .send_prompt(&live.pane_id, PROMPT_OK.into())
        .expect("prompt");
    let history = wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(120),
        |h| h.iter().any(|e| matches!(e.event, AgentEvent::TurnCompleted { .. })),
    );
    assert_prompt_sequence(&history);
    write_live_fixture("codex", "prompt", &history);
    let active = live.tree.active_process_count().expect("job query");
    assert!(active >= 1, "expected server still running before teardown");
    live.teardown("codex-prompt");
}

#[test]
#[ignore = "live codex approval deny"]
fn live_codex_approval_deny() {
    std::env::set_var("LOOMRIA_CODEX_TURN_APPROVAL", "untrusted");
    let live = CodexLive::spawn(Some(CodexThreadOptions {
        approval_policy: Some(serde_json::json!("untrusted")),
        sandbox_policy: Some(serde_json::json!("workspace-write")),
    }));
    live.hub
        .send_prompt(&live.pane_id, PROMPT_APPROVAL.into())
        .expect("prompt");
    let history = wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(180),
        |h| find_approval(h).is_some(),
    );
    let (approval_id, title, detail) = find_approval(&history).unwrap_or_else(|| {
        panic!(
            "approval_requested; types={:?}",
            event_types_from_history(&history)
        )
    });
    assert!(
        !title.is_empty() && title != approval_id,
        "title should be human-readable, got {:?}",
        title
    );
    assert!(
        !detail.is_empty(),
        "detail should describe the command, got {:?}",
        detail
    );
    live.hub
        .respond_approval(&live.pane_id, &approval_id, "deny")
        .expect("deny");
    let history = wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(120),
        |h| {
            let types = event_types_from_history(h);
            types.iter().any(|t| t == "approval_resolved")
                && types.iter().any(|t| t == "turn_completed")
        },
    );
    assert_approval_sequence(&history);
    write_live_fixture("codex", "approval_deny", &history);
    live.teardown("codex-approval");
}

#[test]
#[ignore = "live codex cancel"]
fn live_codex_cancel() {
    let live = CodexLive::spawn(None);
    live.hub
        .send_prompt(&live.pane_id, PROMPT_CANCEL.into())
        .expect("prompt");
    std::thread::sleep(Duration::from_secs(2));
    live.hub.cancel_turn(&live.pane_id).expect("cancel");
    let history = wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(120),
        |h| turn_completed_status(h).is_some(),
    );
    let status = turn_completed_status(&history).expect("turn_completed");
    assert_eq!(
        status,
        loomria_app_lib::protocol::TurnStatus::Cancelled,
        "types={:?}",
        event_types_from_history(&history)
    );
    write_live_fixture("codex", "cancel", &history);
    live.teardown("codex-cancel");
}

#[test]
#[ignore = "live codex tui attach — run in live_final_codex_tui"]
fn live_codex_tui_attach() {
    let live = CodexLive::spawn(None);
    codex_tui_attach_smoke(live.port, &live.thread_id, &live.cwd).expect("tui attach");
    live.teardown("codex-tui");
}

#[test]
#[ignore = "final live: codex TUI attach only"]
fn live_final_codex_tui() {
    let live = CodexLive::spawn(None);
    live.hub
        .send_prompt(&live.pane_id, PROMPT_OK.into())
        .expect("prompt");
    wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(120),
        |h| h.iter().any(|e| matches!(e.event, AgentEvent::TurnCompleted { .. })),
    );
    codex_tui_attach_smoke(live.port, &live.thread_id, &live.cwd).expect("tui attach");
    live.teardown("codex-tui-final");
}

#[test]
#[ignore = "final live: opencode prompt"]
fn live_final_opencode_prompt() {
    let live = OpenCodeLive::spawn();
    live.hub
        .send_prompt(&live.pane_id, PROMPT_OK.into())
        .expect("prompt");
    let history = wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(300),
        |h| h.iter().any(|e| matches!(e.event, AgentEvent::TurnCompleted { .. })),
    );
    assert_prompt_sequence(&history);
    write_live_fixture("opencode", "prompt", &history);
    live.teardown("opencode-prompt-final");
}

#[test]
#[ignore = "final live: claude prompt"]
fn live_final_claude_prompt() {
    std::env::set_var("LOOMRIA_CLAUDE_PERMISSION_MODE", "dontAsk");
    let adapter = adapter_for(ProtocolKind::ClaudeStreamJson).expect("adapter");
    let hub = ProtocolHub::new();
    let pane_id = "live-claude-final".to_string();
    let cwd = std::env::var("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| live_temp_dir("claude-final"));
    hub.register(
        pane_id.clone(),
        adapter,
        Endpoint {
            url: String::new(),
            session_id: Some(uuid::Uuid::new_v4().to_string()),
            cwd: Some(cwd.to_string_lossy().to_string()),
            codex: None,
            connect_pane_id: None,
        },
    )
    .expect("register");
    let child_pid = hub.protocol_child_pid(&pane_id).expect("child pid");
    let tree = loomria_app_lib::process::ProcessTree::new();
    tree.assign_pid(child_pid).expect("assign");
    hub.send_prompt(&pane_id, PROMPT_OK.into()).expect("prompt");
    let history = wait_for_history(
        &hub,
        &pane_id,
        Duration::from_secs(120),
        |h| h.iter().any(|e| matches!(e.event, AgentEvent::TurnCompleted { .. })),
    );
    assert_prompt_sequence(&history);
    write_live_fixture("claude", "prompt", &history);
    hub.unregister(&pane_id);
    drop(hub);
    wait_job_empty(&tree, "claude-final");
}

#[test]
#[ignore = "live opencode prompt"]
fn live_opencode_prompt() {
    let live = OpenCodeLive::spawn();
    live.hub
        .send_prompt(&live.pane_id, PROMPT_OK.into())
        .expect("prompt");
    let history = wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(300),
        |h| h.iter().any(|e| matches!(e.event, AgentEvent::TurnCompleted { .. })),
    );
    assert_prompt_sequence(&history);
    write_live_fixture("opencode", "prompt", &history);
    live.teardown("opencode-prompt");
}

#[test]
#[ignore = "live opencode approval deny"]
fn live_opencode_approval_deny() {
    let live = OpenCodeLive::spawn();
    live.hub
        .send_prompt(&live.pane_id, PROMPT_APPROVAL.into())
        .expect("prompt");
    let history = wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(180),
        |h| find_approval(h).is_some(),
    );
    let (approval_id, title, detail) = find_approval(&history).expect("approval");
    assert!(!title.is_empty());
    assert!(!detail.is_empty());
    live.hub
        .respond_approval(&live.pane_id, &approval_id, "deny")
        .expect("deny");
    let history = wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(120),
        |h| {
            let types = event_types_from_history(h);
            types.iter().any(|t| t == "approval_resolved")
                && types.iter().any(|t| t == "turn_completed")
        },
    );
    assert_approval_sequence(&history);
    write_live_fixture("opencode", "approval_deny", &history);
    live.teardown("opencode-approval");
}

#[test]
#[ignore = "live opencode cancel"]
fn live_opencode_cancel() {
    let live = OpenCodeLive::spawn();
    live.hub
        .send_prompt(&live.pane_id, PROMPT_CANCEL.into())
        .expect("prompt");
    std::thread::sleep(Duration::from_secs(2));
    live.hub.cancel_turn(&live.pane_id).expect("cancel");
    let history = wait_for_history(
        &live.hub,
        &live.pane_id,
        Duration::from_secs(60),
        |h| turn_completed_status(h).is_some(),
    );
    assert_eq!(
        turn_completed_status(&history),
        Some(loomria_app_lib::protocol::TurnStatus::Cancelled)
    );
    write_live_fixture("opencode", "cancel", &history);
    live.teardown("opencode-cancel");
}

#[test]
#[ignore = "live claude prompt"]
fn live_claude_prompt() {
    std::env::set_var("LOOMRIA_CLAUDE_PERMISSION_MODE", "dontAsk");
    let adapter = adapter_for(ProtocolKind::ClaudeStreamJson).expect("adapter");
    let hub = ProtocolHub::new();
    let pane_id = "live-claude".to_string();
    let cwd = live_temp_dir("claude");
    hub.register(
        pane_id.clone(),
        adapter,
        Endpoint {
            url: String::new(),
            session_id: Some(uuid::Uuid::new_v4().to_string()),
            cwd: Some(cwd.to_string_lossy().to_string()),
            codex: None,
            connect_pane_id: None,
        },
    )
    .expect("register");
    let child_pid = hub.protocol_child_pid(&pane_id).expect("child pid");
    let tree = loomria_app_lib::process::ProcessTree::new();
    tree.assign_pid(child_pid).expect("assign claude");
    let tracked = descendant_pids(child_pid);

    hub.send_prompt(&pane_id, PROMPT_OK.into()).expect("prompt");
    let history = wait_for_history(
        &hub,
        &pane_id,
        Duration::from_secs(120),
        |h| h.iter().any(|e| matches!(e.event, AgentEvent::TurnCompleted { .. })),
    );
    assert_prompt_sequence(&history);
    write_live_fixture("claude", "prompt", &history);

    hub.unregister(&pane_id);
    drop(hub);
    wait_job_empty(&tree, "claude-prompt");
    assert_tracked_dead(&tracked, "claude-prompt");
}

#[test]
#[ignore = "live claude unsupported approval/cancel"]
fn live_claude_unsupported_ops() {
    std::env::set_var("LOOMRIA_CLAUDE_PERMISSION_MODE", "dontAsk");
    let adapter = adapter_for(ProtocolKind::ClaudeStreamJson).expect("adapter");
    let session = adapter
        .connect(Endpoint {
            url: String::new(),
            session_id: Some(uuid::Uuid::new_v4().to_string()),
            cwd: Some(live_temp_dir("claude-ops").to_string_lossy().to_string()),
            codex: None,
            connect_pane_id: None,
        })
        .expect("connect");
    let caps = session.capabilities();
    assert!(!caps.approvals);
    assert!(!caps.cancel);
    let err = session
        .respond_to_approval("a", "deny")
        .expect_err("approval");
    assert!(matches!(err, AgentError::Unsupported(_)));
    let err = session.cancel_turn().expect_err("cancel");
    assert!(matches!(err, AgentError::Unsupported(_)));
}

#[test]
#[ignore = "live claude tui resume"]
fn live_claude_tui_resume() {
    std::env::set_var("LOOMRIA_CLAUDE_PERMISSION_MODE", "dontAsk");
    let session_id = uuid::Uuid::new_v4().to_string();
    let cwd = live_temp_dir("claude-resume");
    let catalog = loomria_app_lib::agents::AgentCatalog::load();
    let manifest = catalog.get("claude").expect("claude");
    let resume = manifest.launch_resume_args().expect("resume");
    let argv = loomria_app_lib::session::substitute_args(
        resume,
        0,
        "",
        &session_id,
        &cwd.to_string_lossy(),
    );
    let exe = loomria_app_lib::shell_env::resolve_claude_executable().expect("claude");
    let tree = loomria_app_lib::process::ProcessTree::new();
    let mut child = Command::new(&exe);
    child
        .args(&argv)
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = child.spawn().expect("spawn claude resume");
    tree.assign_pid(child.id()).expect("assign");
    std::thread::sleep(Duration::from_secs(4));
    let _ = child.kill();
    let _ = child.wait();
    drop(tree);
}
