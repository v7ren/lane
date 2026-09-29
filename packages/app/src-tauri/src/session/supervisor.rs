//! Shared server spawn + readiness for dual-shape sessions.

use crate::agents::{AgentManifest, ReadyProbe, StoredLaunchAttach, StoredLaunchServer};
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub enum ReadyKind {
    Tcp,
    HttpHealth { path: String },
    StdoutRegex { pattern: String },
}

#[derive(Debug)]
pub struct SpawnedServer {
    pub child: Child,
    pub port: u16,
    pub base_url: String,
    pub ws_url: String,
}

pub fn pick_free_port(lo: u16, hi: u16) -> Result<u16, String> {
    for port in lo..=hi {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err(format!("no free TCP port in {lo}-{hi}"))
}

pub fn wait_tcp(port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if TcpListener::bind(("127.0.0.1", port)).is_err() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err(format!("tcp readiness timeout on port {port}"))
}

pub fn wait_http_health(base_url: &str, path: &str, timeout: Duration) -> Result<(), String> {
    let base = base_url.trim_end_matches('/');
    let path = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let url = format!("{base}{path}");
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if ureq::get(&url)
            .timeout(Duration::from_secs(3))
            .call()
            .map(|r| r.status() == 200)
            .unwrap_or(false)
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(format!("http readiness timeout for {url}"))
}

pub fn ready_kind(probe: &ReadyProbe) -> ReadyKind {
    match probe.kind.as_str() {
        "http" => ReadyKind::HttpHealth {
            path: probe
                .path
                .clone()
                .unwrap_or_else(|| "/global/health".into()),
        },
        "stdout_regex" => ReadyKind::StdoutRegex {
            pattern: probe.path.clone().unwrap_or_default(),
        },
        _ => ReadyKind::Tcp,
    }
}

pub fn ready_timeout(probe: &ReadyProbe) -> Duration {
    Duration::from_millis(probe.timeout_ms.unwrap_or(45_000))
}

pub fn wait_ready(probe: &ReadyProbe, port: u16, base_url: &str) -> Result<(), String> {
    let timeout = ready_timeout(probe);
    match ready_kind(probe) {
        ReadyKind::Tcp => wait_tcp(port, timeout),
        ReadyKind::HttpHealth { path } => wait_http_health(base_url, &path, timeout),
        ReadyKind::StdoutRegex { .. } => Ok(()),
    }
}

pub fn substitute_args(
    args: &[String],
    port: u16,
    url: &str,
    session_id: &str,
    cwd: &str,
) -> Vec<String> {
    args.iter()
        .map(|arg| {
            arg.replace("{port}", &port.to_string())
                .replace("{url}", url)
                .replace("{session_id}", session_id)
                .replace("{cwd}", cwd)
        })
        .collect()
}

pub fn spawn_manifest_server(
    exe: &str,
    manifest: &AgentManifest,
    server: &StoredLaunchServer,
    cwd: &Path,
    port_lo: u16,
    port_hi: u16,
) -> Result<SpawnedServer, String> {
    let port = pick_free_port(port_lo, port_hi)?;
    let http_base = format!("http://127.0.0.1:{port}");
    let ws_url = format!("ws://127.0.0.1:{port}");
    let args = substitute_args(&server.args, port, &http_base, "", &cwd.to_string_lossy());
    let mut cmd = Command::new(exe);
    cmd.args(&args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env("PATH", crate::shell_env::path_for_spawn());
    #[cfg(windows)]
    cmd.env("Path", crate::shell_env::path_for_spawn());

    let child = cmd
        .spawn()
        .map_err(|e| format!("spawn {} {}: {e}", exe, args.join(" ")))?;

    let probe = server
        .ready
        .as_ref()
        .cloned()
        .unwrap_or(ReadyProbe {
            kind: "tcp".into(),
            path: None,
            timeout_ms: Some(45_000),
        });
    wait_ready(&probe, port, &http_base)?;

    let _ = manifest;
    Ok(SpawnedServer {
        child,
        port,
        base_url: http_base,
        ws_url,
    })
}

pub fn build_attach_argv(
    attach: &StoredLaunchAttach,
    port: u16,
    base_url: &str,
    session_id: &str,
    cwd: &str,
) -> Vec<String> {
    substitute_args(&attach.args, port, base_url, session_id, cwd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitutes_placeholders() {
        let args = substitute_args(
            &["serve", "--port", "{port}", "--url", "{url}", "-s", "{session_id}"]
                .map(String::from),
            4099,
            "http://127.0.0.1:4099",
            "ses_abc",
            "/tmp",
        );
        assert_eq!(args[2], "4099");
        assert_eq!(args[4], "http://127.0.0.1:4099");
        assert_eq!(args[6], "ses_abc");
    }
}
