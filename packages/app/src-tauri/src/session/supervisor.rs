//! Shared server spawn + readiness for dual-shape sessions.

use std::net::TcpListener;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub enum ReadyKind {
    Tcp,
    HttpHealth { path: String },
    StdoutRegex { pattern: String },
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

pub fn wait_http_health(base_url: &str, timeout: Duration) -> Result<(), String> {
    crate::opencode::client::wait_for_health(base_url, timeout)
}
