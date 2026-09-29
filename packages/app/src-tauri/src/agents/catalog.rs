//! Load built-in and user agent manifests.

use super::manifest::AgentManifest;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

const BUILTIN: &[(&str, &str)] = &[
    ("claude.toml", include_str!("../../manifests/claude.toml")),
    ("codex.toml", include_str!("../../manifests/codex.toml")),
    ("opencode.toml", include_str!("../../manifests/opencode.toml")),
    (
        "opencode_native.toml",
        include_str!("../../manifests/opencode_native.toml"),
    ),
    ("cmd.toml", include_str!("../../manifests/cmd.toml")),
    ("powershell.toml", include_str!("../../manifests/powershell.toml")),
    ("bash.toml", include_str!("../../manifests/bash.toml")),
    ("cursor.toml", include_str!("../../manifests/cursor.toml")),
];

#[derive(Debug, Clone, Serialize)]
pub struct ManifestFileError {
    pub file: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManifestLoadReport {
    pub errors: Vec<ManifestFileError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentManifestSummary {
    pub id: String,
    pub label: String,
    pub description: String,
    pub icon: String,
    pub is_tui: bool,
    pub command: String,
    pub base_args: Vec<String>,
    pub show_in_new_pane_menu: bool,
    pub default_worker: bool,
    pub spawn_handler: Option<String>,
}

#[derive(Clone)]
pub struct AgentCatalog {
    manifests: BTreeMap<String, AgentManifest>,
    pub report: ManifestLoadReport,
}

impl AgentCatalog {
    pub fn load() -> Self {
        Self::load_with_user_agents_dir(Some(crate::app_paths::user_agents_dir().as_path()))
    }

    /// Built-ins plus optional user manifest directory (for tests and overrides).
    pub fn load_with_user_agents_dir(user_dir: Option<&Path>) -> Self {
        let mut manifests = BTreeMap::new();
        let mut errors = Vec::new();

        for (name, source) in BUILTIN {
            match AgentManifest::from_toml(source) {
                Ok(m) => {
                    manifests.insert(m.id.clone(), m);
                }
                Err(err) => {
                    errors.push(ManifestFileError {
                        file: format!("builtin:{name}"),
                        message: err.to_string(),
                    });
                }
            }
        }

        if let Some(user_dir) = user_dir {
            merge_user_manifest_dir(&mut manifests, &mut errors, user_dir);
        }

        Self {
            manifests,
            report: ManifestLoadReport { errors },
        }
    }

    pub fn get(&self, id: &str) -> Option<&AgentManifest> {
        self.manifests.get(id)
    }

    pub fn contains(&self, id: &str) -> bool {
        self.manifests.contains_key(id)
    }

    pub fn ids(&self) -> Vec<String> {
        self.manifests.keys().cloned().collect()
    }

    pub fn summaries(&self) -> Vec<AgentManifestSummary> {
        self.manifests
            .values()
            .filter(|m| is_catalog_agent_visible(&m.id))
            .filter_map(|m| {
                let (command, base_args) = m.resolve_tui_command().ok()?;
                if !crate::shell_env::is_command_available(&command) {
                    return None;
                }
                Some(AgentManifestSummary {
                    id: m.id.clone(),
                    label: m.label.clone(),
                    description: m.description.clone(),
                    icon: m.icon.clone(),
                    is_tui: m.is_tui,
                    command,
                    base_args,
                    show_in_new_pane_menu: m.show_in_new_pane_menu,
                    default_worker: m.default_worker,
                    spawn_handler: m.spawn_handler.map(|h| match h {
                        super::manifest::SpawnHandler::OpencodeNative => {
                            "opencode_native".to_string()
                        }
                    }),
                })
            })
            .collect()
    }

    pub fn list_response(&self) -> AgentsListResponse {
        AgentsListResponse {
            agents: self.summaries(),
            report: self.report.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentsListResponse {
    pub agents: Vec<AgentManifestSummary>,
    pub report: ManifestLoadReport,
}

const HARNESS_AGENT_IDS: &[&str] = &["fake-agent", "broken-agent"];

fn is_catalog_agent_visible(id: &str) -> bool {
    !HARNESS_AGENT_IDS.contains(&id)
}

#[cfg(test)]
mod catalog_tests {
    use super::*;
    use std::fs;

    #[test]
    fn summaries_exclude_harness_agent_ids() {
        let temp = tempfile::tempdir().expect("tempdir");
        let manifest = r#"
schema_version = 1
id = "fake-agent"
label = "Fake Agent (fixture)"
description = "test"
icon = "FA"
is_tui = true
show_in_new_pane_menu = true

[launch.tui.windows]
command = "cmd.exe"
args = ["/C", "echo ok"]
"#;
        fs::write(temp.path().join("fake-agent.toml"), manifest).expect("write");
        let catalog = AgentCatalog::load_with_user_agents_dir(Some(temp.path()));
        assert!(
            !catalog
                .summaries()
                .iter()
                .any(|summary| summary.id == "fake-agent"),
            "harness agents must not appear in production catalog"
        );
    }
}

fn merge_user_manifest_dir(
    manifests: &mut BTreeMap<String, AgentManifest>,
    errors: &mut Vec<ManifestFileError>,
    user_dir: &Path,
) {
    if !user_dir.is_dir() {
        return;
    }
    if let Ok(entries) = fs::read_dir(user_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("toml") {
                continue;
            }
            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.display().to_string());
            let source = match fs::read_to_string(&path) {
                Ok(s) => s,
                Err(err) => {
                    errors.push(ManifestFileError {
                        file: file_name,
                        message: err.to_string(),
                    });
                    continue;
                }
            };
            match AgentManifest::from_toml(&source) {
                Ok(m) => {
                    manifests.insert(m.id.clone(), m);
                }
                Err(err) => {
                    errors.push(ManifestFileError {
                        file: file_name,
                        message: err.to_string(),
                    });
                }
            }
        }
    }
}

pub fn resolve_tui_for_id(catalog: &AgentCatalog, id: &str) -> Result<(String, Vec<String>), String> {
    let manifest = catalog
        .get(id)
        .ok_or_else(|| format!("unknown agent: {id}"))?;
    manifest
        .resolve_tui_command()
        .map_err(|e| e.to_string())
}
