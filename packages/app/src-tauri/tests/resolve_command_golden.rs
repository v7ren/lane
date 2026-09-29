//! Golden snapshots for manifest TUI launch — must match `resolve_command.*.json`.

use loomria_app_lib::agents::AgentCatalog;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct Entry {
    program: String,
    args: Vec<String>,
}

fn fixture_os_name() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(format!("resolve_command.{}.json", fixture_os_name()))
}

#[test]
fn resolve_command_matches_golden_fixture() {
    let catalog = AgentCatalog::load();
    let raw = fs::read_to_string(fixture_path())
        .unwrap_or_else(|e| panic!("read fixture: {e}"));
    let expected: BTreeMap<String, Entry> =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse fixture: {e}"));

    for (key, entry) in &expected {
        let manifest = catalog
            .get(key)
            .unwrap_or_else(|| panic!("catalog missing agent {key}"));
        let (program, args) = manifest
            .resolve_tui_command()
            .unwrap_or_else(|e| panic!("resolve {key}: {e}"));
        assert_eq!(program, entry.program, "program for {key}");
        assert_eq!(args, entry.args, "args for {key}");
    }
}
