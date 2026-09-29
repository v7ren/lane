//! Golden snapshots for `pty::agents::resolve_command` — Phase 5 must match these.

use puppet_master_app_lib::pty::agents::{AgentType, resolve_command};
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

fn all_agent_types() -> [AgentType; 8] {
    [
        AgentType::Claude,
        AgentType::Codex,
        AgentType::Opencode,
        AgentType::OpencodeNative,
        AgentType::Cmd,
        AgentType::Powershell,
        AgentType::Bash,
        AgentType::Cursor,
    ]
}

#[test]
fn resolve_command_matches_golden_fixture() {
    let raw = fs::read_to_string(fixture_path())
        .unwrap_or_else(|e| panic!("read fixture: {e}"));
    let expected: BTreeMap<String, Entry> =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse fixture: {e}"));

    for agent in all_agent_types() {
        let key = agent.as_str();
        let entry = expected
            .get(key)
            .unwrap_or_else(|| panic!("fixture missing key {key}"));
        let (program, args) = resolve_command(agent);
        assert_eq!(program, entry.program, "program for {key}");
        let resolved_args: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
        assert_eq!(resolved_args, entry.args, "args for {key}");
    }
}
