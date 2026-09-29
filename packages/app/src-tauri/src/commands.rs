//! Tauri command surface — thin wrappers around the PTY registry.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::pty::{
    registry_get_project_path, registry_kill_all, registry_kill_pane, registry_read_buffer,
    registry_read_raw_buffer, registry_read_snapshot, registry_resize, registry_set_project_path,
    registry_spawn_pane, registry_write_input, PaneInfo, PaneRegistry, SpawnPaneArgs,
};
use crate::settings_store;

#[derive(Default)]
pub struct AppState {
    pub registry: Arc<Mutex<PaneRegistry>>,
    pub public_settings: Mutex<Value>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(Mutex::new(PaneRegistry::new())),
            public_settings: Mutex::new(settings_store::default_public_settings()),
        }
    }
}

#[tauri::command]
pub async fn list_panes(state: State<'_, AppState>) -> Result<Vec<PaneInfo>, String> {
    Ok(state.registry.lock().list())
}

#[tauri::command]
pub async fn spawn_pane(
    app: AppHandle,
    state: State<'_, AppState>,
    args: SpawnPaneArgs,
) -> Result<String, String> {
    registry_spawn_pane(&state.registry, &app, args)
}

#[tauri::command]
pub async fn kill_pane_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<(), String> {
    registry_kill_pane(&state.registry, &pane_id)?;
    let _ = app.emit("pty://panes-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn kill_all_panes(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    registry_kill_all(&state.registry);
    let _ = app.emit("pty://panes-changed", ());
    Ok(())
}

#[derive(Deserialize)]
pub struct WriteInputArgs {
    pub text: String,
    #[serde(default = "default_true")]
    pub append_newline: bool,
    #[serde(default)]
    pub via_opencode_api: bool,
    #[serde(default)]
    pub model_provider: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
}

fn default_true() -> bool {
    true
}

#[tauri::command]
pub async fn write_pane_input(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
    args: WriteInputArgs,
) -> Result<(), String> {
    let settings = state.public_settings.lock().clone();
    let model = crate::opencode::resolve_model(
        args.model_provider.as_deref(),
        args.model_id.as_deref(),
        &settings,
    );
    registry_write_input(
        &state.registry,
        &app,
        &pane_id,
        &args.text,
        args.append_newline,
        args.via_opencode_api,
        model,
    )
}

#[tauri::command]
pub async fn read_pane_buffer(
    state: State<'_, AppState>,
    pane_id: String,
    lines: usize,
) -> Result<String, String> {
    registry_read_buffer(&state.registry, &pane_id, lines)
}

#[tauri::command]
pub async fn read_pane_snapshot(
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<String, String> {
    registry_read_snapshot(&state.registry, &pane_id)
}

#[tauri::command]
pub async fn read_pane_raw_buffer(
    state: State<'_, AppState>,
    pane_id: String,
    lines: usize,
) -> Result<Vec<u8>, String> {
    registry_read_raw_buffer(&state.registry, &pane_id, lines)
}

#[derive(Deserialize)]
pub struct SwitchModelArgs {
    #[serde(default)]
    pub model_provider: Option<String>,
    pub model_id: String,
}

#[tauri::command]
pub async fn switch_agent_model(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
    args: SwitchModelArgs,
) -> Result<serde_json::Value, String> {
    let settings = state.public_settings.lock().clone();
    let model = crate::opencode::resolve_model(
        args.model_provider.as_deref(),
        Some(args.model_id.as_str()),
        &settings,
    )
    .ok_or_else(|| "model_id required".to_string())?;
    crate::opencode::switch_native_model(&state.registry, &app, &pane_id, &model)?;
    Ok(crate::opencode::switch_model_response(&state.registry, &pane_id, &model))
}

#[tauri::command]
pub async fn resize_pane(
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let changed = registry_resize(&state.registry, &pane_id, cols, rows)?;
    if changed {
        crate::bridge::push_pane_resize_sse(&pane_id, cols, rows);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_public_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings_json: String,
) -> Result<(), String> {
    let parsed: Value = serde_json::from_str(&settings_json)
        .map_err(|err| format!("invalid settings json: {err}"))?;
    let merged =
        settings_store::merge_public_settings(&settings_store::default_public_settings(), &parsed);
    *state.public_settings.lock() = merged;
    let _ = app;
    Ok(())
}

#[tauri::command]
pub async fn set_project_path(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let normalized = crate::project_path::normalize_project_path(std::path::Path::new(&path))?;
    registry_set_project_path(&state.registry, normalized.to_string_lossy().into_owned());
    Ok(())
}

#[tauri::command]
pub async fn get_project_path_cmd(state: State<'_, AppState>) -> Result<String, String> {
    Ok(registry_get_project_path(&state.registry))
}

#[tauri::command]
pub async fn push_chat_event(event_json: String) -> Result<(), String> {
    let payload = format!("event: chat\ndata: {event_json}\n\n");
    crate::bridge::push_sse(payload);
    Ok(())
}

#[tauri::command]
pub async fn push_settings_event(settings_json: String) -> Result<(), String> {
    let payload = format!("event: settings\ndata: {settings_json}\n\n");
    crate::bridge::push_sse(payload);
    Ok(())
}

#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn get_opencode_key_status() -> Result<crate::opencode::keys::OpenCodeKeyStatus, String> {
    crate::opencode::keys::status()
}

#[tauri::command]
pub fn set_opencode_automation_settings(
    mode: String,
    restart_pane_on_rotate: bool,
) -> Result<crate::opencode::keys::OpenCodeKeyStatus, String> {
    let parsed = crate::opencode::keys::KeyAutomationMode::parse(&mode)
        .ok_or_else(|| "mode must be auto_if_backup or notify_only".to_string())?;
    crate::opencode::keys::set_automation_settings(Some(parsed), Some(restart_pane_on_rotate))
}

#[tauri::command]
pub fn set_opencode_key_settings(
    key_automation_mode: Option<String>,
    restart_pane_on_rotate: Option<bool>,
) -> Result<crate::opencode::keys::OpenCodeKeyStatus, String> {
    crate::opencode::keys::patch_settings(&crate::opencode::keys::OpenCodeKeySettingsPatch {
        key_automation_mode,
        restart_pane_on_rotate,
    })
}

#[tauri::command]
pub fn set_opencode_key_profile(
    profile_id: String,
    api_key: String,
    label: Option<String>,
) -> Result<(), String> {
    crate::opencode::keys::set_profile_api_key(&profile_id, &api_key, label.as_deref())
}

#[tauri::command]
pub fn capture_opencode_key_profile(
    profile_id: String,
    label: Option<String>,
) -> Result<(), String> {
    crate::opencode::keys::capture_profile_from_disk(&profile_id, label.as_deref())
}

#[derive(Debug, Clone, Serialize)]
pub struct RotateOpenCodeKeyResult {
    pub ok: bool,
    pub active_profile: String,
    pub profiles: Vec<crate::opencode::keys::OpenCodeKeyProfileInfo>,
    pub restarted_panes: Vec<String>,
}

#[tauri::command]
pub fn rotate_opencode_key(
    app: AppHandle,
    state: State<'_, AppState>,
    profile: Option<String>,
    pane_id: Option<String>,
) -> Result<RotateOpenCodeKeyResult, String> {
    let target = crate::opencode::keys::RotateTarget::parse(profile.as_deref().unwrap_or("next"))
        .ok_or_else(|| "profile must be next, a, or b".to_string())?;
    let status = crate::opencode::keys::rotate(target)?;
    let restarted = if let Some(pane_id) = pane_id.filter(|id| !id.is_empty()) {
        vec![crate::opencode::native::restart_native_pane(
            state.registry.clone(),
            &app,
            &pane_id,
        )?]
    } else {
        crate::opencode::native::restart_all_native_panes(state.registry.clone(), &app)?
    };
    Ok(RotateOpenCodeKeyResult {
        ok: true,
        active_profile: status.active_profile,
        profiles: status.profiles,
        restarted_panes: restarted,
    })
}
