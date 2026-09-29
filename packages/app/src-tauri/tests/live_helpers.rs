#![allow(dead_code)]

use loomria_app_lib::protocol::{
    adapter_for, AgentEvent, AgentEventEnvelope, CodexThreadOptions, Endpoint, TurnStatus,
};
use loomria_app_lib::agents::{AgentCatalog, ProtocolKind};
use loomria_app_lib::process::ProcessTree;
use loomria_app_lib::session::{build_attach_argv, spawn_manifest_server, ProtocolHub};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub fn live_temp_dir(agent: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!("loomria-live-{agent}"));
    fs::create_dir_all(&base).expect("create live temp dir");
    base
}

pub fn event_types_from_history(history: &[AgentEventEnvelope]) -> Vec<String> {
    history
        .iter()
        .map(|e| {
            serde_json::to_value(&e.event).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect()
}

pub fn wait_for_history(
    hub: &Arc<ProtocolHub>,
    pane_id: &str,
    timeout: Duration,
    mut predicate: impl FnMut(&[AgentEventEnvelope]) -> bool,
) -> Vec<AgentEventEnvelope> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let history = hub.history(pane_id);
        if predicate(&history) {
            return history;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    hub.history(pane_id)
}

pub fn assert_prompt_sequence(types: &[String]) {
    assert!(
        types.iter().any(|t| t == "turn_started"),
        "missing turn_started in {types:?}"
    );
    assert!(
        types.iter().any(|t| t == "message_delta" || t == "message_completed"),
        "missing assistant message in {types:?}"
    );
    assert!(
        types.iter().any(|t| t == "turn_completed"),
        "missing turn_completed in {types:?}"
    );
}

pub fn assert_turn_ok(types: &[String]) {
    assert!(
        types.iter().any(|t| t == "turn_completed"),
        "missing turn_completed in {types:?}"
    );
}

pub fn sanitize_event_sequence(events: &[AgentEventEnvelope]) -> Value {
    let types: Vec<String> = event_types_from_history(events);
    let mut out = Vec::new();
    for env in events {
        let v = serde_json::to_value(&env.event).unwrap();
        out.push(sanitize_event_value(v));
    }
    serde_json::json!({ "types": types, "events": out })
}

fn sanitize_event_value(mut v: Value) -> Value {
    if let Some(obj) = v.as_object_mut() {
        for key in ["text", "detail", "title", "message", "input_summary", "output_summary"] {
            if let Some(s) = obj.get(key).and_then(|x| x.as_str()) {
                let trimmed = if s.len() > 40 {
                    format!("{}…", s.chars().take(40).collect::<String>())
                } else {
                    s.to_string()
                };
                obj.insert(key.to_string(), Value::String(trimmed));
            }
        }
        for key in [
            "turn_id",
            "message_id",
            "approval_id",
            "tool_id",
            "pane_id",
            "session_id",
        ] {
            if obj.contains_key(key) {
                obj.insert(key.to_string(), Value::String("<id>".into()));
            }
        }
        if let Some(paths) = obj.get_mut("paths").and_then(|p| p.as_array_mut()) {
            for p in paths {
                if let Some(s) = p.as_str() {
                    *p = Value::String(sanitize_path(s));
                }
            }
        }
    }
    v
}

fn sanitize_path(path: &str) -> String {
    if path.contains("loomria-live") {
        "<tmpdir>/…".into()
    } else if path.len() > 40 {
        format!("<path>/{}…", path.chars().rev().take(20).collect::<String>().chars().rev().collect::<String>())
    } else {
        path.to_string()
    }
}

pub fn write_live_fixture(agent: &str, name: &str, events: &[AgentEventEnvelope]) {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/live");
    fs::create_dir_all(&dir).expect("fixture dir");
    let path = dir.join(format!("{agent}_{name}.json"));
    fs::write(
        &path,
        serde_json::to_string_pretty(&sanitize_event_sequence(events)).unwrap(),
    )
    .expect("write fixture");
}

pub fn process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ exit 0 }} else {{ exit 1 }}"
            ),
        ])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn descendant_pids(root: u32) -> HashSet<u32> {
    let mut set = HashSet::new();
    if root != 0 {
        set.insert(root);
    }
    let out = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                r#"
$root = {root}
$all = Get-CimInstance Win32_Process
$queue = [System.Collections.Queue]::new()
$queue.Enqueue($root)
$seen = @{{}}
while ($queue.Count -gt 0) {{
  $pid = $queue.Dequeue()
  if ($seen.ContainsKey($pid)) {{ continue }}
  $seen[$pid] = $true
  $all | Where-Object {{ $_.ParentProcessId -eq $pid }} | ForEach-Object {{
    $queue.Enqueue($_.ProcessId)
  }}
}}
$seen.Keys | ForEach-Object {{ Write-Output $_ }}
"#
            ),
        ])
        .output()
        .expect("powershell descendants");
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        if let Ok(pid) = line.trim().parse::<u32>() {
            set.insert(pid);
        }
    }
    set
}

pub fn wait_job_empty(tree: &ProcessTree, label: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if tree.active_process_count().unwrap_or(0) == 0 {
            return;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let active = tree.active_process_count().unwrap_or(u32::MAX);
    panic!("{label}: job ActiveProcesses still {active} after 5s");
}

pub fn assert_tracked_dead(pids: &HashSet<u32>, label: &str) {
    std::thread::sleep(Duration::from_secs(5));
    let alive: Vec<u32> = pids.iter().copied().filter(|p| process_alive(*p)).collect();
    assert!(alive.is_empty(), "{label}: tracked PIDs still alive: {alive:?}");
}

pub struct CodexLive {
    pub cwd: PathBuf,
    pub tree: ProcessTree,
    pub server: Child,
    pub thread_id: String,
    pub hub: Arc<ProtocolHub>,
    pub pane_id: String,
    pub tracked: HashSet<u32>,
    pub port: u16,
    pub ws_url: String,
}

impl CodexLive {
    pub fn spawn(codex_options: Option<CodexThreadOptions>) -> Self {
        let cwd = live_temp_dir("codex");
        let catalog = AgentCatalog::load();
        let manifest = catalog.get("codex").expect("codex manifest");
        let server_cfg = manifest.launch_server().expect("server");
        let exe = loomria_app_lib::shell_env::resolve_codex_executable().expect("codex");
        let tree = ProcessTree::new();
        let spawned = spawn_manifest_server(
            &exe,
            manifest,
            server_cfg,
            Path::new(&cwd),
            4200,
            4210,
        )
        .expect("spawn codex app-server");
        let server_pid = spawned.child.id();
        tree.assign_pid(server_pid).expect("assign server");

        let thread_id = uuid::Uuid::new_v4().to_string();
        let hub = ProtocolHub::new();
        let pane_id: String = "live-codex".into();
        let adapter = adapter_for(ProtocolKind::CodexAppServer).expect("adapter");
        let codex = codex_options.or_else(|| {
            Some(CodexThreadOptions {
                approval_policy: Some(serde_json::json!("never")),
                sandbox_policy: Some(serde_json::json!("workspace-write")),
            })
        });
        hub.register(
            pane_id.clone(),
            adapter,
            Endpoint {
                url: spawned.ws_url.clone(),
                session_id: Some(thread_id.clone()),
                cwd: Some(cwd.to_string_lossy().to_string()),
                codex,
            },
        )
        .expect("register codex hub");

        let tracked = descendant_pids(server_pid);
        std::thread::sleep(Duration::from_secs(2));

        Self {
            cwd,
            tree,
            server: spawned.child,
            thread_id,
            hub,
            pane_id,
            tracked,
            port: spawned.port,
            ws_url: spawned.ws_url,
        }
    }

    pub fn history_types(&self) -> Vec<String> {
        event_types_from_history(&self.hub.history(&self.pane_id))
    }

    pub fn teardown(mut self, label: &str) {
        let _ = self.hub.unregister(&self.pane_id);
        let _ = self.server.kill();
        let _ = self.server.wait();
        drop(self.hub);
        wait_job_empty(&self.tree, label);
        assert_tracked_dead(&self.tracked, label);
    }
}

pub fn codex_tui_attach_smoke(port: u16, thread_id: &str, cwd: &Path) -> Result<(), String> {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    let catalog = AgentCatalog::load();
    let manifest = catalog.get("codex").expect("codex");
    let attach = manifest.launch_attach().expect("attach");
    let base = format!("http://127.0.0.1:{port}");
    let argv = build_attach_argv(
        attach,
        port,
        &base,
        thread_id,
        &cwd.to_string_lossy(),
    );
    let exe = loomria_app_lib::shell_env::resolve_codex_executable()?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty: {e}"))?;
    let mut cmd = CommandBuilder::new(&exe);
    for arg in argv {
        cmd.arg(arg);
    }
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn attach: {e}"))?;
    let pid = child.process_id().unwrap_or(0);
    drop(pair.slave);
    let tree = ProcessTree::new();
    tree.assign_pid(pid).expect("assign attach");
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("pty reader: {e}"))?;
    let mut buf = String::new();
    let _ = reader.read_to_string(&mut buf);
    std::thread::sleep(Duration::from_secs(4));
    let _ = child.kill();
    drop(child);
    drop(tree);
    let lower = buf.to_lowercase();
    if lower.contains("refusing to start") || lower.contains("stdin is not a terminal") {
        return Err(format!("codex attach output: {buf}"));
    }
    Ok(())
}

pub struct OpenCodeLive {
    pub cwd: PathBuf,
    pub tree: ProcessTree,
    pub server: Child,
    pub session_id: String,
    pub hub: Arc<ProtocolHub>,
    pub pane_id: String,
    pub tracked: HashSet<u32>,
    pub base_url: String,
}

impl OpenCodeLive {
    pub fn spawn() -> Self {
        let cwd = live_temp_dir("opencode");
        write_opencode_permission_config(&cwd);
        let catalog = AgentCatalog::load();
        let manifest = catalog.get("opencode_native").expect("manifest");
        let server_cfg = manifest.launch_server().expect("server");
        let exe = loomria_app_lib::shell_env::resolve_opencode_executable().expect("opencode");
        let tree = ProcessTree::new();
        let spawned = spawn_manifest_server(
            &exe,
            manifest,
            server_cfg,
            Path::new(&cwd),
            4220,
            4230,
        )
        .expect("spawn opencode");
        let server_pid = spawned.child.id();
        tree.assign_pid(server_pid).expect("assign");

        let session = loomria_app_lib::opencode::client::create_session(
            &spawned.base_url,
            "loomria live",
        )
        .expect("create session");

        let hub = ProtocolHub::new();
        let pane_id: String = "live-opencode".into();
        let adapter = adapter_for(ProtocolKind::OpencodeHttp).expect("adapter");
        hub.register(
            pane_id.clone(),
            adapter,
            Endpoint {
                url: spawned.base_url.clone(),
                session_id: Some(session.id.clone()),
                cwd: Some(cwd.to_string_lossy().to_string()),
                codex: None,
            },
        )
        .expect("register");

        let tracked = descendant_pids(server_pid);
        std::thread::sleep(Duration::from_secs(2));

        Self {
            cwd,
            tree,
            server: spawned.child,
            session_id: session.id,
            hub,
            pane_id,
            tracked,
            base_url: spawned.base_url,
        }
    }

    pub fn teardown(mut self, label: &str) {
        let _ = self.hub.unregister(&self.pane_id);
        let _ = self.server.kill();
        let _ = self.server.wait();
        drop(self.hub);
        wait_job_empty(&self.tree, label);
        assert_tracked_dead(&self.tracked, label);
    }
}

fn write_opencode_permission_config(cwd: &Path) {
    let config = serde_json::json!({
        "permission": {
            "bash": "ask"
        }
    });
    fs::write(
        cwd.join("opencode.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .expect("write opencode.json");
}

pub fn find_approval(history: &[AgentEventEnvelope]) -> Option<(String, String, String)> {
    for env in history {
        if let AgentEvent::ApprovalRequested {
            approval_id,
            title,
            detail,
            ..
        } = &env.event
        {
            return Some((approval_id.clone(), title.clone(), detail.clone()));
        }
    }
    None
}

pub fn turn_completed_status(history: &[AgentEventEnvelope]) -> Option<TurnStatus> {
    for env in history.iter().rev() {
        if let AgentEvent::TurnCompleted { status, .. } = &env.event {
            return Some(*status);
        }
    }
    None
}
