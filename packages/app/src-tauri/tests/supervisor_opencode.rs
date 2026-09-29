//! Regression: manifest-driven OpenCode serve reaches HTTP health.

use loomria_app_lib::agents::AgentCatalog;
use loomria_app_lib::session::{spawn_manifest_server, wait_http_health};
use std::path::Path;
use std::time::Duration;

const PORT_LO: u16 = 4100;
const PORT_HI: u16 = 4110;

#[test]
#[ignore = "spawns real opencode serve; run with cargo test -- --ignored"]
fn opencode_supervisor_serve_health() {
    let exe = loomria_app_lib::shell_env::resolve_opencode_executable().expect("opencode on PATH");
    let manifest = AgentCatalog::load();
    let agent = manifest
        .get("opencode_native")
        .expect("opencode_native manifest");
    let server = agent.launch_server().expect("launch.server");
    let tmp = tempfile::tempdir().expect("tempdir");
    let mut spawned = spawn_manifest_server(
        &exe,
        agent,
        server,
        Path::new(tmp.path()),
        PORT_LO,
        PORT_HI,
    )
    .expect("spawn serve");
    wait_http_health(&spawned.base_url, "/global/health", Duration::from_secs(5))
        .expect("health");
    let _ = spawned.child.kill();
}
