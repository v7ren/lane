//! Claude stream-json headless pane (Shape 3) — Agent Mode is the surface.

use crate::agents::AgentCatalog;
use crate::events::{PaneId, SystemEvent};
use crate::pty::registry::{PaneInfo, PaneRegistry, PaneState, SpawnPaneArgs};
use crate::pty::scrollback::Scrollback;
use crate::pty::status::PaneStatus;
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tracing::info;
use uuid::Uuid;

const SCROLLBACK_CAP: usize = 256;

pub fn spawn_headless_pane(
    registry: Arc<Mutex<PaneRegistry>>,
    _catalog: &AgentCatalog,
    app: &AppHandle,
    args: SpawnPaneArgs,
) -> Result<String, String> {
    let cwd = crate::project_path::resolve_spawn_cwd(
        args.cwd.clone(),
        registry.lock().project_path.clone(),
    )?
    .to_string_lossy()
    .to_string();

    let pane_id = args.pane_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let session_id = Uuid::new_v4().to_string();

    {
        let mut reg = registry.lock();
        if reg.panes.contains_key(&pane_id) {
            reg.kill(&pane_id);
            crate::events::emit(SystemEvent::PaneKilled {
                pane_id: PaneId(pane_id.clone()),
            });
        }
    }

    let (pair, child) = open_holder_pty()?;
    let pid = child.process_id().unwrap_or(0);
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {e}"))?;

    let info = PaneInfo {
        id: pane_id.clone(),
        agent_type: "claude".to_string(),
        pid,
        status: "running".into(),
        created_at: chrono_now_ms(),
        last_output_at: None,
        cwd: cwd.clone(),
        cols: 1,
        rows: 1,
        surface: "headless".into(),
    };

    let process_tree = crate::process::ProcessTree::new();
    crate::process::assign_pid_to_pane_job(&process_tree, pid);

    let pane = PaneState {
        info,
        scrollback: Arc::new(Mutex::new(Scrollback::new(SCROLLBACK_CAP))),
        screen: Arc::new(Mutex::new(vt100::Parser::new(1, 1, SCROLLBACK_CAP))),
        status: Arc::new(Mutex::new(PaneStatus::Running)),
        last_output: Arc::new(Mutex::new(Instant::now())),
        master: pair.master,
        writer,
        child,
        exited: Arc::new(Mutex::new(false)),
        opencode: None,
        opencode_key_event: None,
        codex: None,
        claude_session_id: Some(session_id.clone()),
        process_tree,
    };

    registry.lock().panes.insert(pane_id.clone(), pane);

    crate::events::emit(SystemEvent::PaneSpawned {
        pane_id: PaneId(pane_id.clone()),
        agent_type: "claude".to_string(),
        pid,
        cwd,
        cols: 1,
        rows: 1,
    });
    info!(pane = %pane_id, session_id = %session_id, "claude headless pane spawned");
    let _ = app.emit("pty://panes-changed", ());
    Ok(pane_id)
}

pub fn claude_session_id(registry: &Mutex<PaneRegistry>, pane_id: &str) -> Result<String, String> {
    let reg = registry.lock();
    let pane = reg
        .panes
        .get(pane_id)
        .ok_or_else(|| format!("unknown pane: {pane_id}"))?;
    pane.claude_session_id
        .clone()
        .ok_or_else(|| format!("pane {pane_id} is not a headless claude session"))
}

fn open_holder_pty() -> Result<(portable_pty::PtyPair, Box<dyn portable_pty::Child + Send + Sync>), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 1,
            cols: 1,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;
    let mut cmd = if cfg!(windows) {
        let mut b = CommandBuilder::new("ping");
        b.args(["-n", "99999", "127.0.0.1"]);
        b
    } else {
        let mut b = CommandBuilder::new("sleep");
        b.args(["99999"]);
        b
    };
    cmd.env("PATH", crate::shell_env::path_for_spawn());
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn holder: {e}"))?;
    Ok((pair, child))
}

fn chrono_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
