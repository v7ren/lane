//! Agent manifest schema and validation.

use regex::Regex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SCHEMA_VERSION: u32 = 1;

const ALLOWED_PLACEHOLDERS: &[&str] = &["{port}", "{cwd}", "{session_id}", "{url}"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProtocolKind {
    None,
    CodexAppServer,
    OpencodeHttp,
    ClaudeStreamJson,
    Acp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpawnHandler {
    OpencodeNative,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlatformLaunch {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub powershell_shim: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LaunchTui {
    pub windows: Option<PlatformLaunch>,
    pub macos: Option<PlatformLaunch>,
    pub linux: Option<PlatformLaunch>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LaunchServer {
    pub args: Vec<String>,
    pub protocol: ProtocolKind,
    #[serde(default)]
    pub protocol_versions: Option<String>,
    pub ready: Option<ReadyProbe>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReadyProbe {
    pub kind: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct StoredLaunchServer {
    pub args: Vec<String>,
    pub protocol: ProtocolKind,
    pub ready: Option<ReadyProbe>,
}

#[derive(Debug, Clone)]
pub struct StoredLaunchAttach {
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AttentionRule {
    pub pattern: String,
    pub means: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentManifestRaw {
    pub schema_version: u32,
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default = "default_true")]
    pub is_tui: bool,
    #[serde(default)]
    pub show_in_new_pane_menu: bool,
    #[serde(default)]
    pub default_worker: bool,
    #[serde(default)]
    pub spawn_handler: Option<SpawnHandler>,
    pub launch: Option<LaunchSection>,
    #[serde(default)]
    pub attention: Vec<AttentionRule>,
    #[serde(default)]
    pub env: std::collections::HashMap<String, String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct LaunchSection {
    pub tui: Option<LaunchTui>,
    pub server: Option<LaunchServer>,
    #[serde(default)]
    pub attach: Option<LaunchAttach>,
    #[serde(default)]
    pub resume: Option<LaunchResume>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LaunchAttach {
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LaunchResume {
    pub args: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct AgentManifest {
    pub id: String,
    pub label: String,
    pub description: String,
    pub icon: String,
    pub is_tui: bool,
    pub show_in_new_pane_menu: bool,
    pub default_worker: bool,
    pub spawn_handler: Option<SpawnHandler>,
    pub launch_tui: LaunchTui,
    pub launch_server: Option<StoredLaunchServer>,
    pub launch_attach: Option<StoredLaunchAttach>,
    pub launch_resume_args: Option<Vec<String>>,
    pub attention: Vec<CompiledAttention>,
    pub attention_regexes: Vec<Regex>,
}

#[derive(Debug, Clone)]
pub struct CompiledAttention {
    pub pattern: String,
    pub means: String,
}

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("unsupported schema_version {0} (expected {1})")]
    UnsupportedSchema(u32, u32),
    #[error("invalid id: {0}")]
    InvalidId(String),
    #[error("missing launch.tui for current platform")]
    MissingTuiLaunch,
    #[error("invalid placeholder in args: {0}")]
    InvalidPlaceholder(String),
    #[error("invalid attention regex: {0}")]
    InvalidAttentionRegex(String),
    #[error("parse error: {0}")]
    Parse(String),
}

impl AgentManifest {
    pub fn from_toml(source: &str) -> Result<Self, ManifestError> {
        let raw: AgentManifestRaw = toml::from_str(source)
            .map_err(|e| ManifestError::Parse(e.to_string()))?;
        raw.into_manifest()
    }

    pub fn platform_launch(&self) -> Result<&PlatformLaunch, ManifestError> {
        platform_launch(&self.launch_tui)
    }

    pub fn resolve_tui_command(&self) -> Result<(String, Vec<String>), ManifestError> {
        let launch = self.platform_launch()?;
        Ok((launch.command.clone(), launch.args.clone()))
    }

    pub fn uses_powershell_shim(&self) -> bool {
        self.platform_launch()
            .map(|p| p.powershell_shim)
            .unwrap_or(false)
    }

    pub fn launch_resume_args(&self) -> Option<&[String]> {
        self.launch_resume_args.as_deref()
    }

    pub fn launch_server(&self) -> Option<&StoredLaunchServer> {
        self.launch_server.as_ref()
    }

    pub fn launch_attach(&self) -> Option<&StoredLaunchAttach> {
        self.launch_attach.as_ref()
    }
}

impl AgentManifestRaw {
    fn into_manifest(self) -> Result<AgentManifest, ManifestError> {
        if self.schema_version != SCHEMA_VERSION {
            return Err(ManifestError::UnsupportedSchema(
                self.schema_version,
                SCHEMA_VERSION,
            ));
        }
        if self.id.is_empty() || self.id.contains('/') || self.id.contains('\\') {
            return Err(ManifestError::InvalidId(self.id));
        }

        let launch = self.launch.ok_or(ManifestError::MissingTuiLaunch)?;
        let launch_tui = launch.tui.ok_or(ManifestError::MissingTuiLaunch)?;

        validate_launch_tui(&launch_tui)?;

        if let Some(server) = &launch.server {
            validate_args(&server.args)?;
        }
        if let Some(attach) = &launch.attach {
            validate_args(&attach.args)?;
        }
        if let Some(resume) = &launch.resume {
            validate_args(&resume.args)?;
        }

        let mut attention_regexes = Vec::new();
        let mut compiled = Vec::new();
        for rule in &self.attention {
            let re = Regex::new(&rule.pattern)
                .map_err(|e| ManifestError::InvalidAttentionRegex(e.to_string()))?;
            attention_regexes.push(re);
            compiled.push(CompiledAttention {
                pattern: rule.pattern.clone(),
                means: rule.means.clone(),
            });
        }

        let launch_resume_args = launch.resume.map(|r| r.args);
        let launch_server = launch.server.map(|s| StoredLaunchServer {
            args: s.args,
            protocol: s.protocol,
            ready: s.ready,
        });
        let launch_attach = launch.attach.map(|a| StoredLaunchAttach { args: a.args });

        Ok(AgentManifest {
            id: self.id,
            label: self.label,
            description: self.description,
            icon: self.icon,
            is_tui: self.is_tui,
            show_in_new_pane_menu: self.show_in_new_pane_menu,
            default_worker: self.default_worker,
            spawn_handler: self.spawn_handler,
            launch_tui,
            launch_server,
            launch_attach,
            launch_resume_args,
            attention: compiled,
            attention_regexes,
        })
    }
}

fn validate_launch_tui(tui: &LaunchTui) -> Result<(), ManifestError> {
    for launch in [&tui.windows, &tui.macos, &tui.linux] {
        if let Some(p) = launch {
            validate_args(&p.args)?;
        }
    }
    Ok(())
}

fn validate_args(args: &[String]) -> Result<(), ManifestError> {
    for arg in args {
        validate_placeholders(arg)?;
    }
    Ok(())
}

fn validate_placeholders(arg: &str) -> Result<(), ManifestError> {
    let mut i = 0;
    while let Some(start) = arg[i..].find('{') {
        let abs = i + start;
        let rest = &arg[abs..];
        if let Some(end) = rest.find('}') {
            let token = &rest[..=end];
            if !ALLOWED_PLACEHOLDERS.contains(&token) {
                return Err(ManifestError::InvalidPlaceholder(token.to_string()));
            }
            i = abs + end + 1;
        } else {
            break;
        }
    }
    Ok(())
}

pub fn platform_launch(tui: &LaunchTui) -> Result<&PlatformLaunch, ManifestError> {
    let launch = match crate::platform::current_os() {
        crate::platform::Os::Windows => tui.windows.as_ref(),
        crate::platform::Os::MacOs => tui.macos.as_ref(),
        crate::platform::Os::Linux => tui.linux.as_ref(),
    };
    launch.ok_or(ManifestError::MissingTuiLaunch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_placeholder() {
        let toml = r#"
schema_version = 1
id = "x"
label = "X"
[launch.tui.windows]
command = "node"
args = ["--foo", "{bad}"]
"#;
        let err = AgentManifest::from_toml(toml).unwrap_err();
        assert!(matches!(err, ManifestError::InvalidPlaceholder(_)));
    }

    #[test]
    fn rejects_unknown_schema_version() {
        let toml = r#"
schema_version = 99
id = "x"
label = "X"
[launch.tui.windows]
command = "node"
args = []
"#;
        let err = AgentManifest::from_toml(toml).unwrap_err();
        assert!(matches!(err, ManifestError::UnsupportedSchema(99, 1)));
    }
}
