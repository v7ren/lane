//! `sessions.json` — resumable session metadata (Phase 7).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const MAX_SESSIONS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedSession {
    pub manifest_id: String,
    pub cwd: String,
    pub native_session_id: Option<String>,
    pub shape: String,
    pub pane_id: Option<String>,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SessionFile {
    sessions: Vec<PersistedSession>,
}

pub fn sessions_path() -> PathBuf {
    crate::app_paths::app_data_dir().join("sessions.json")
}

pub fn load() -> Vec<PersistedSession> {
    let path = sessions_path();
    if !path.is_file() {
        return Vec::new();
    }
    let raw = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&raw)
        .map(|f: SessionFile| f.sessions)
        .unwrap_or_default()
}

pub fn save(sessions: &[PersistedSession]) -> Result<(), String> {
    let path = sessions_path();
    let trimmed: Vec<PersistedSession> = sessions
        .iter()
        .take(MAX_SESSIONS)
        .cloned()
        .collect();
    let file = SessionFile {
        sessions: trimmed,
    };
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("serialize sessions: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

pub fn upsert_spawn(
    manifest_id: &str,
    cwd: &str,
    pane_id: &str,
    shape: &str,
    native_session_id: Option<String>,
) {
    let mut list = load();
    list.retain(|s| s.pane_id.as_deref() != Some(pane_id));
    list.insert(
        0,
        PersistedSession {
            manifest_id: manifest_id.to_string(),
            cwd: cwd.to_string(),
            native_session_id,
            shape: shape.to_string(),
            pane_id: Some(pane_id.to_string()),
            updated_at_ms: crate::events::now_ms(),
        },
    );
    if list.len() > MAX_SESSIONS {
        list.truncate(MAX_SESSIONS);
    }
    let _ = save(&list);
}

pub fn remove_pane(pane_id: &str) {
    let mut list = load();
    list.retain(|s| s.pane_id.as_deref() != Some(pane_id));
    let _ = save(&list);
}

pub fn resumable() -> Vec<PersistedSession> {
    load()
        .into_iter()
        .filter(|s| manifest_has_resume(&s.manifest_id))
        .collect()
}

fn manifest_has_resume(manifest_id: &str) -> bool {
    let catalog = crate::agents::AgentCatalog::load();
    catalog
        .get(manifest_id)
        .and_then(|m| m.launch_resume_args())
        .is_some()
}
