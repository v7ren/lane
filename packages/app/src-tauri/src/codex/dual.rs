//! Codex dual-shape spawn: `app-server` + WS thread + remote TUI attach.

use crate::agents::AgentCatalog;
use crate::codex::link::CodexLink;
use crate::events::{PaneId, SystemEvent};
use crate::pty::registry::{PaneInfo, PaneRegistry, PaneState, SpawnPaneArgs};
use crate::pty::scrollback::Scrollback;
use crate::pty::status::PaneStatus;
use crate::session::{build_attach_argv, spawn_manifest_server, SessionStateStore};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::sync::Arc;
use std::thread;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};
use uuid::Uuid;

const SCROLLBACK_CAP: usize = 10_000;

pub fn spawn_dual_pane(
    registry: Arc<Mutex<PaneRegistry>>,
    catalog: &AgentCatalog,
    app: &AppHandle,
    args: SpawnPaneArgs,
    session_store: Option<&SessionStateStore>,
) -> Result<String, String> {
    let codex_exe = crate::shell_env::resolve_codex_executable()?;
    let manifest = catalog
        .get("codex")
        .ok_or_else(|| "missing codex manifest".to_string())?;
    let server = manifest
        .launch_server()
        .ok_or_else(|| "codex manifest missing launch.server".to_string())?;
    let attach = manifest
        .launch_attach()
        .ok_or_else(|| "codex manifest missing launch.attach".to_string())?;

    let cwd = crate::project_path::resolve_spawn_cwd(
        args.cwd.clone(),
        registry.lock().project_path.clone(),
    )?
    .to_string_lossy()
    .to_string();

    let cols = args.cols.unwrap_or(120);
    let rows = args.rows.unwrap_or(30);
    let pane_id = args.pane_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    {
        let mut reg = registry.lock();
        if reg.panes.contains_key(&pane_id) {
            reg.kill(&pane_id);
            crate::events::emit(SystemEvent::PaneKilled {
                pane_id: PaneId(pane_id.clone()),
            });
        }
    }

    let port_cfg = crate::ports::load_config();
    let spawned = match spawn_manifest_server(
        &codex_exe,
        manifest,
        server,
        std::path::Path::new(&cwd),
        port_cfg.agent_min,
        port_cfg.agent_max,
    ) {
        Ok(s) => s,
        Err(err) => {
            warn!(%pane_id, %err, "codex app-server spawn failed; falling back to PTY-only");
            let fallback_args = SpawnPaneArgs {
                agent_type: args.agent_type.clone(),
                cwd: args.cwd.clone(),
                cols: args.cols,
                rows: args.rows,
                extra_args: args.extra_args.clone(),
                pane_id: Some(pane_id.clone()),
                surface: args.surface.clone(),
                resume_session_id: None,
            };
            return fallback_pty(
                registry,
                catalog,
                app,
                fallback_args,
                session_store,
                format!("Codex app-server failed: {err}"),
            );
        }
    };

    let port = spawned.port;
    crate::ports::register("codex-server", port, Some(&pane_id), Some(spawned.child.id()));
    let ws_url = spawned.ws_url.clone();
    let http_base = spawned.base_url.clone();
    let mut serve_child = spawned.child;
    let serve_pid = serve_child.id();

    // Thread identity: real Codex (0.159) rejects a client-supplied thread id; the
    // server allocates it in the `thread/start` response. So the thread is created
    // FIRST, over a short-lived WS client, and the TUI is then spawned with
    // `codex --remote ws://... resume <real id>`. The protocol hub later connects with
    // the same id (`thread/resume`), so the TUI and the WS client share ONE thread.
    // A brand new thread has no rollout until its first turn and `resume` would fail
    // ("no rollout found"), so `start_thread_blocking` also sends `thread/name/set`,
    // which persists the rollout without spending a model turn (verified live, 0.159).
    let thread_id = match crate::protocol::CodexWsClient::start_thread_blocking(
        ws_url.clone(),
        cwd.clone(),
        crate::protocol::CodexThreadOptions::default(),
        std::time::Duration::from_secs(25),
    ) {
        Ok((_bootstrap, id)) => id,
        Err(err) => {
            let _ = serve_child.kill();
            return Err(format!("codex thread/start failed: {err}"));
        }
    };

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;

    let attach_argv = build_attach_argv(attach, port, &http_base, &thread_id, &cwd);
    let cmd = build_codex_attach_command(catalog, &cwd, &attach_argv)?;
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| {
            let _ = serve_child.kill();
            format!("spawn codex attach: {e}")
        })?;
    let pid = child.process_id().unwrap_or(0);
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("clone_reader: {e}"))?;

    let scrollback = Arc::new(Mutex::new(Scrollback::new(SCROLLBACK_CAP)));
    let screen = Arc::new(Mutex::new(vt100::Parser::new(rows, cols, SCROLLBACK_CAP)));
    let status = Arc::new(Mutex::new(PaneStatus::Running));
    let last_output = Arc::new(Mutex::new(Instant::now()));
    let exited = Arc::new(Mutex::new(false));

    let info = PaneInfo {
        id: pane_id.clone(),
        agent_type: "codex".to_string(),
        pid,
        status: "running".into(),
        created_at: chrono_now_ms(),
        last_output_at: Some(chrono_now_ms()),
        cwd: cwd.clone(),
        cols,
        rows,
        surface: "tui".into(),
    };

    let codex = CodexLink::new(ws_url.clone(), thread_id, cwd.clone(), serve_child);
    let serve_handle = codex.serve_handle();

    let process_tree = crate::process::ProcessTree::new();
    crate::process::assign_pid_to_pane_job(&process_tree, serve_pid);
    crate::process::assign_pid_to_pane_job(&process_tree, pid);

    let pane = PaneState {
        info,
        scrollback: scrollback.clone(),
        screen: screen.clone(),
        status: status.clone(),
        last_output: last_output.clone(),
        master: pair.master,
        writer,
        child,
        exited: exited.clone(),
        opencode: None,
        opencode_key_event: None,
        codex: Some(codex),
        claude_session_id: None,
        process_tree,
    };

    spawn_reader_thread(
        pane_id.clone(),
        app.clone(),
        reader,
        scrollback,
        screen,
        status,
        last_output,
        exited,
        serve_handle,
    );

    registry.lock().panes.insert(pane_id.clone(), pane);

    crate::events::emit(SystemEvent::PaneSpawned {
        pane_id: PaneId(pane_id.clone()),
        agent_type: "codex".to_string(),
        pid,
        cwd: cwd.clone(),
        cols,
        rows,
    });
    info!(pane = %pane_id, agent = "codex", pid, "codex dual pane spawned");
    let _ = app.emit("pty://panes-changed", ());
    Ok(pane_id)
}

fn fallback_pty(
    registry: Arc<Mutex<PaneRegistry>>,
    catalog: &AgentCatalog,
    app: &AppHandle,
    args: SpawnPaneArgs,
    session_store: Option<&SessionStateStore>,
    message: String,
) -> Result<String, String> {
    let mut plain = args;
    plain.pane_id = plain.pane_id.or_else(|| Some(Uuid::new_v4().to_string()));
    let pane_id = crate::pty::registry::spawn_plain_tui_pane(&registry, catalog, app, plain)?;
    if let Some(store) = session_store {
        if let Some(snap) = store.apply_agent_event(
            &pane_id,
            &crate::protocol::AgentEvent::Error { message },
        ) {
            crate::session::push_agent_state(store, snap);
        }
    }
    Ok(pane_id)
}

pub fn build_codex_attach_pty_command(
    catalog: &AgentCatalog,
    cwd: &str,
    attach_argv: &[String],
) -> Result<CommandBuilder, String> {
    build_codex_attach_command(catalog, cwd, attach_argv)
}

fn build_codex_attach_command(
    catalog: &AgentCatalog,
    cwd: &str,
    attach_argv: &[String],
) -> Result<CommandBuilder, String> {
    let manifest = catalog
        .get("codex")
        .ok_or_else(|| "missing codex manifest".to_string())?;
    let launch = manifest.platform_launch().map_err(|e| e.to_string())?;
    let cmd = launch.command.as_str();

    #[cfg(windows)]
    {
        if launch.powershell_shim {
            let mut cmd_builder = CommandBuilder::new("powershell.exe");
            cmd_builder.arg("-NoLogo");
            cmd_builder.arg("-NoExit");
            cmd_builder.arg("-Command");
            let quoted = attach_argv
                .iter()
                .map(|a| format!("'{}'", a.replace('\'', "''")))
                .collect::<Vec<_>>();
            let invoke = if quoted.is_empty() {
                format!("& '{}'", cmd.replace('\'', "''"))
            } else {
                format!("& '{}' {}", cmd.replace('\'', "''"), quoted.join(" "))
            };
            cmd_builder.arg(invoke);
            cmd_builder.cwd(cwd);
            apply_pty_env(&mut cmd_builder);
            return Ok(cmd_builder);
        }
    }

    let mut cmd_builder = CommandBuilder::new(cmd);
    for a in attach_argv {
        cmd_builder.arg(a);
    }
    cmd_builder.cwd(cwd);
    apply_pty_env(&mut cmd_builder);
    Ok(cmd_builder)
}

fn apply_pty_env(cmd: &mut CommandBuilder) {
    cmd.env("PATH", crate::shell_env::path_for_spawn());
    #[cfg(windows)]
    cmd.env("Path", crate::shell_env::path_for_spawn());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    crate::process::configure_unix_session(cmd);
}

fn spawn_reader_thread(
    pane_id: String,
    app: AppHandle,
    mut reader: Box<dyn Read + Send>,
    scrollback: Arc<Mutex<Scrollback>>,
    screen: Arc<Mutex<vt100::Parser>>,
    status: Arc<Mutex<PaneStatus>>,
    last_output: Arc<Mutex<Instant>>,
    exited: Arc<Mutex<bool>>,
    serve_handle: Arc<std::sync::Mutex<Option<std::process::Child>>>,
) {
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let agent_type = "codex".to_string();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    scrollback.lock().push_chunk(chunk);
                    screen.lock().process(chunk);
                    *last_output.lock() = Instant::now();
                    *status.lock() = PaneStatus::Running;
                    let text = String::from_utf8_lossy(chunk);
                    for event in crate::agents::observe_agent_output(&agent_type, &pane_id, &text) {
                        crate::events::emit(event);
                    }
                    let payload: Vec<u8> = chunk.to_vec();
                    let _ = app.emit(
                        "terminal-data",
                        serde_json::json!({ "pane_id": pane_id, "data": payload }),
                    );
                }
                Err(_) => break,
            }
        }
        *exited.lock() = true;
        *status.lock() = PaneStatus::Error;
        if let Ok(mut guard) = serve_handle.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
        let _ = app.emit(
            "pty://status",
            serde_json::json!({ "pane_id": pane_id, "status": "error" }),
        );
        let _ = app.emit("pty://exit", serde_json::json!({ "pane_id": pane_id }));
    });
}

fn chrono_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
