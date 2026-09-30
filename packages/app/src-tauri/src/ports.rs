//! Port handler: which TCP ports Loomria uses, who holds them, and the
//! configurable ranges it is allowed to pick from (so it stays out of the way of
//! other local projects).

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::net::{SocketAddr, TcpStream};
use std::process::Command;
use std::time::Duration;

pub const DEFAULT_AGENT_MIN: u16 = 4096;
pub const DEFAULT_AGENT_MAX: u16 = 4199;
pub const DEFAULT_BRIDGE_MIN: u16 = 17321;
pub const DEFAULT_BRIDGE_MAX: u16 = 17399;
#[cfg(debug_assertions)]
const DEFAULT_DEV_SERVER_PORT: u16 = 1420;
const MIN_ALLOWED: u16 = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortConfig {
    pub agent_min: u16,
    pub agent_max: u16,
    pub bridge_min: u16,
    pub bridge_max: u16,
}

impl Default for PortConfig {
    fn default() -> Self {
        Self {
            agent_min: DEFAULT_AGENT_MIN,
            agent_max: DEFAULT_AGENT_MAX,
            bridge_min: DEFAULT_BRIDGE_MIN,
            bridge_max: DEFAULT_BRIDGE_MAX,
        }
    }
}

impl PortConfig {
    pub fn validate(&self) -> Result<(), String> {
        for (name, lo, hi) in [
            ("agent", self.agent_min, self.agent_max),
            ("bridge", self.bridge_min, self.bridge_max),
        ] {
            if lo < MIN_ALLOWED {
                return Err(format!("{name} range must start at {MIN_ALLOWED} or above"));
            }
            if lo > hi {
                return Err(format!("{name} range start {lo} is above its end {hi}"));
            }
        }
        if self.agent_min <= self.bridge_max && self.bridge_min <= self.agent_max {
            return Err("agent and bridge ranges must not overlap".into());
        }
        Ok(())
    }
}

fn config_path() -> std::path::PathBuf {
    crate::app_paths::app_data_dir().join("ports.json")
}

/// Current config; falls back to defaults when missing or invalid.
pub fn load_config() -> PortConfig {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|text| serde_json::from_str::<PortConfig>(&text).ok())
        .filter(|cfg| cfg.validate().is_ok())
        .unwrap_or_default()
}

pub fn save_config(cfg: PortConfig) -> Result<PortConfig, String> {
    cfg.validate()?;
    crate::app_paths::ensure_app_data_dir()?;
    let text = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path(), text).map_err(|e| format!("write ports.json: {e}"))?;
    Ok(cfg)
}

#[derive(Debug, Clone)]
struct Allocation {
    role: String,
    port: u16,
    pane_id: Option<String>,
    pid: Option<u32>,
}

static ALLOCATIONS: Lazy<Mutex<Vec<Allocation>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Record a port Loomria took. Re-registering a port replaces its old entry.
pub fn register(role: &str, port: u16, pane_id: Option<&str>, pid: Option<u32>) {
    let mut all = ALLOCATIONS.lock();
    all.retain(|a| a.port != port);
    all.push(Allocation {
        role: role.to_string(),
        port,
        pane_id: pane_id.map(str::to_string),
        pid,
    });
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct PortOwner {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortEntry {
    pub role: String,
    pub port: u16,
    pub pane_id: Option<String>,
    pub pid: Option<u32>,
    pub listening: bool,
    pub owner: Option<PortOwner>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForeignPort {
    pub port: u16,
    pub owner: Option<PortOwner>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PortsReport {
    pub config: PortConfig,
    pub entries: Vec<PortEntry>,
    /// Ports inside Loomria's ranges held by something that is not Loomria.
    pub foreign_in_range: Vec<ForeignPort>,
}

/// Parse `netstat -ano` output into (port, pid) for listening sockets.
pub fn parse_netstat(text: &str) -> Vec<(u16, u32)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || !cols[0].eq_ignore_ascii_case("TCP") {
            continue;
        }
        if !cols[3].eq_ignore_ascii_case("LISTENING") {
            continue;
        }
        let Some(port) = cols[1].rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) else {
            continue;
        };
        if let Ok(pid) = cols[4].parse::<u32>() {
            out.push((port, pid));
        }
    }
    out
}

/// Parse `lsof -nP -iTCP -sTCP:LISTEN` output into (port, pid, name).
#[cfg_attr(windows, allow(dead_code))]
pub fn parse_lsof(text: &str) -> Vec<(u16, u32, String)> {
    let mut out = Vec::new();
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 9 {
            continue;
        }
        let Ok(pid) = cols[1].parse::<u32>() else {
            continue;
        };
        let Some(port) = cols[8].rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) else {
            continue;
        };
        out.push((port, pid, cols[0].to_string()));
    }
    out
}

#[cfg(windows)]
fn hidden(cmd: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
}

#[cfg(windows)]
fn process_name(pid: u32) -> String {
    let out = hidden(Command::new("tasklist").args([
        "/FI",
        &format!("PID eq {pid}"),
        "/FO",
        "CSV",
        "/NH",
    ]))
    .output();
    out.ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .and_then(|s| {
            s.lines()
                .next()
                .and_then(|l| l.split("\",\"").next())
                .map(|n| n.trim_matches('"').to_string())
        })
        .filter(|n| !n.is_empty() && !n.starts_with("INFO"))
        .unwrap_or_else(|| "unknown".into())
}

/// Every listening TCP socket on the machine as (port, owner).
fn listening_sockets() -> Vec<(u16, Option<PortOwner>)> {
    #[cfg(windows)]
    {
        let Ok(out) = hidden(Command::new("netstat").args(["-ano", "-p", "TCP"])).output() else {
            return Vec::new();
        };
        let text = String::from_utf8_lossy(&out.stdout);
        let mut names: std::collections::HashMap<u32, String> = std::collections::HashMap::new();
        parse_netstat(&text)
            .into_iter()
            .map(|(port, pid)| {
                let name = names.entry(pid).or_insert_with(|| process_name(pid)).clone();
                (port, Some(PortOwner { pid, name }))
            })
            .collect()
    }
    #[cfg(not(windows))]
    {
        let Ok(out) = Command::new("lsof")
            .args(["-nP", "-iTCP", "-sTCP:LISTEN"])
            .output()
        else {
            return Vec::new();
        };
        let text = String::from_utf8_lossy(&out.stdout);
        parse_lsof(&text)
            .into_iter()
            .map(|(port, pid, name)| (port, Some(PortOwner { pid, name })))
            .collect()
    }
}

fn is_listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(150)).is_ok()
}

pub fn build_report() -> PortsReport {
    let config = load_config();
    let sockets = listening_sockets();
    let owner_of = |port: u16| {
        sockets
            .iter()
            .find(|(p, _)| *p == port)
            .and_then(|(_, o)| o.clone())
    };

    #[allow(unused_mut)]
    let mut allocations = ALLOCATIONS.lock().clone();
    #[cfg(debug_assertions)]
    allocations.push(Allocation {
        role: "dev-server".into(),
        port: std::env::var("LOOMRIA_DEV_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_DEV_SERVER_PORT),
        pane_id: None,
        pid: None,
    });
    allocations.sort_by_key(|a| a.port);

    let entries: Vec<PortEntry> = allocations
        .iter()
        .map(|a| PortEntry {
            role: a.role.clone(),
            port: a.port,
            pane_id: a.pane_id.clone(),
            pid: a.pid,
            listening: is_listening(a.port),
            owner: owner_of(a.port),
        })
        .collect();

    let ours: Vec<u16> = allocations.iter().map(|a| a.port).collect();
    let in_range = |p: u16| {
        (config.agent_min..=config.agent_max).contains(&p)
            || (config.bridge_min..=config.bridge_max).contains(&p)
    };
    let mut foreign: Vec<ForeignPort> = sockets
        .iter()
        .filter(|(p, _)| in_range(*p) && !ours.contains(p))
        .map(|(p, o)| ForeignPort {
            port: *p,
            owner: o.clone(),
        })
        .collect();
    foreign.sort_by_key(|f| f.port);
    foreign.dedup_by_key(|f| f.port);

    PortsReport {
        config,
        entries,
        foreign_in_range: foreign,
    }
}

#[tauri::command]
pub async fn ports_report() -> Result<PortsReport, String> {
    tauri::async_runtime::spawn_blocking(build_report)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ports_get_config() -> PortConfig {
    load_config()
}

#[tauri::command]
pub fn ports_set_config(config: PortConfig) -> Result<PortConfig, String> {
    save_config(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_valid() {
        assert!(PortConfig::default().validate().is_ok());
    }

    #[test]
    fn rejects_inverted_low_and_overlapping_ranges() {
        let base = PortConfig::default();
        assert!(PortConfig { agent_min: 5000, agent_max: 4000, ..base }.validate().is_err());
        assert!(PortConfig { agent_min: 80, ..base }.validate().is_err());
        assert!(PortConfig { bridge_min: 4150, bridge_max: 4300, ..base }
            .validate()
            .is_err());
    }

    #[test]
    fn parses_netstat_listening_rows_only() {
        let text = "\
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:4096         0.0.0.0:0              LISTENING       1234
  TCP    [::]:17321             [::]:0                 LISTENING       99
  TCP    127.0.0.1:50000        127.0.0.1:4096         ESTABLISHED     55
";
        assert_eq!(parse_netstat(text), vec![(4096, 1234), (17321, 99)]);
    }

    #[test]
    fn parses_lsof_rows() {
        let text = "\
COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node       42   me  23u  IPv4    0x1      0t0  TCP 127.0.0.1:4097 (LISTEN)
";
        let rows = parse_lsof(text);
        assert_eq!(rows, vec![(4097, 42, "node".to_string())]);
    }

    #[test]
    fn register_replaces_same_port() {
        register("test-role-a", 59001, Some("p1"), Some(1));
        register("test-role-b", 59001, Some("p2"), Some(2));
        let all = ALLOCATIONS.lock();
        let hits: Vec<_> = all.iter().filter(|a| a.port == 59001).collect();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].role, "test-role-b");
    }
}
