//! Gate 5 proof: user `agents/*.toml` merge + spawn without a rebuild.

use loomria_app_lib::agents::AgentCatalog;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::fs;
use std::io::Read;
use std::time::{Duration, Instant};

const MARKER: &str = "loomria-new-agent-ok";

#[test]
fn user_manifest_echo_agent_loads_and_spawns() {
    let temp = tempfile::tempdir().expect("tempdir");
    let manifest = if cfg!(windows) {
        format!(
            r#"
schema_version = 1
id = "echo-agent"
label = "Echo proof agent"
description = "Stream A gate 5 spawn proof"
icon = "EA"
is_tui = true

[launch.tui.windows]
command = "cmd.exe"
args = ["/C", "echo {MARKER} & pause"]
"#
        )
    } else {
        format!(
            r#"
schema_version = 1
id = "echo-agent"
label = "Echo proof agent"
description = "Stream A gate 5 spawn proof"
icon = "EA"
is_tui = true

[launch.tui.linux]
command = "sh"
args = ["-c", "echo {MARKER}; sleep 30"]
"#
        )
    };
    fs::write(temp.path().join("echo-agent.toml"), manifest).expect("write manifest");

    let catalog = AgentCatalog::load_with_user_agents_dir(Some(temp.path()));
    let agent = catalog
        .get("echo-agent")
        .expect("echo-agent should load from temp user dir");

    let (command, args) = agent.resolve_tui_command().expect("resolve launch");
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("openpty");

    let mut cmd = CommandBuilder::new(&command);
    for arg in &args {
        cmd.arg(arg);
    }
    loomria_app_lib::process::configure_unix_session(&mut cmd);

    let mut child = pair.slave.spawn_command(cmd).expect("spawn");
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().expect("reader");

    let deadline = Instant::now() + Duration::from_secs(8);
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    while Instant::now() < deadline {
        if let Ok(n) = reader.read(&mut chunk) {
            if n > 0 {
                buf.extend_from_slice(&chunk[..n]);
                if String::from_utf8_lossy(&buf).contains(MARKER) {
                    let _ = child.kill();
                    return;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    panic!(
        "expected PTY output to contain {MARKER}; got {:?}",
        String::from_utf8_lossy(&buf)
    );
}

#[test]
fn malformed_user_manifest_surfaces_in_report() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("broken-agent.toml"), "not valid toml [[[\n").expect("write");

    let catalog = AgentCatalog::load_with_user_agents_dir(Some(temp.path()));
    assert!(
        catalog
            .report
            .errors
            .iter()
            .any(|e| e.file == "broken-agent.toml"),
        "errors: {:?}",
        catalog.report.errors
    );
}
