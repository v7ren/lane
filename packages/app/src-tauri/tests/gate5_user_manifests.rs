//! Gate 5 proof on the developer machine: user `agents/*.toml` merge + error reporting.

use loomria_app_lib::agents::AgentCatalog;
use std::path::PathBuf;

#[test]
fn user_agents_dir_fake_agent_and_malformed_report() {
    let agents_dir = user_agents_dir();
    if !agents_dir.is_dir() {
        eprintln!("skip: no user agents dir at {}", agents_dir.display());
        return;
    }

    let catalog = AgentCatalog::load();
    let has_fake = catalog.get("fake-agent").is_some();
    assert!(
        has_fake,
        "expected fake-agent manifest in {}; ids: {:?}",
        agents_dir.display(),
        catalog.ids()
    );

    let broken_errors = catalog
        .report
        .errors
        .iter()
        .filter(|e| e.file.contains("broken") || e.file == "broken-agent.toml")
        .collect::<Vec<_>>();
    assert!(
        !broken_errors.is_empty(),
        "expected a named error for broken-agent.toml; errors: {:?}",
        catalog.report.errors
    );
}

fn user_agents_dir() -> PathBuf {
    let home = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    #[cfg(target_os = "windows")]
    {
        return home.join("com.loomria.app").join("agents");
    }
    #[cfg(target_os = "macos")]
    {
        return home
            .join("Library")
            .join("Application Support")
            .join("com.loomria.app")
            .join("agents");
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        home.join(".local")
            .join("share")
            .join("com.loomria.app")
            .join("agents")
    }
}
