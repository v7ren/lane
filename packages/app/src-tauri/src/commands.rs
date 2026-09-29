//! Tauri command surface — thin wrappers around the PTY registry.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

use crate::agents::AgentsListResponse;
use crate::protocol::{AgentEventEnvelope, Capabilities};
use crate::session::ProtocolHub;
use crate::pty::{
    registry_get_project_path, registry_kill_all, registry_kill_pane, registry_read_buffer,
    registry_read_raw_buffer, registry_read_snapshot, registry_resize, registry_set_project_path,
    registry_spawn_pane, registry_write_input, PaneInfo, PaneRegistry, SpawnPaneArgs,
};
use crate::settings_store;

pub struct AppState {
    pub registry: Arc<Mutex<PaneRegistry>>,
    pub public_settings: Mutex<Value>,
    pub agents: Arc<crate::agents::AgentCatalog>,
    pub session_states: Arc<crate::session::SessionStateStore>,
    pub protocol_hub: Arc<ProtocolHub>,
}

impl AppState {
    pub fn new() -> Self {
        let session_states = Arc::new(crate::session::SessionStateStore::new());
        let protocol_hub = ProtocolHub::new();
        Self {
            registry: Arc::new(Mutex::new(PaneRegistry::new())),
            public_settings: Mutex::new(settings_store::default_public_settings()),
            agents: Arc::new(crate::agents::AgentCatalog::load()),
            session_states: Arc::clone(&session_states),
            protocol_hub,
        }
    }
}

#[tauri::command]
pub async fn list_resumable_sessions() -> Result<Vec<crate::session::PersistedSession>, String> {
    Ok(crate::session::persist::resumable())
}

#[derive(Deserialize)]
pub struct SendSessionPromptArgs {
    pub pane_id: String,
    pub text: String,
}

#[tauri::command]
pub async fn send_session_prompt(
    state: State<'_, AppState>,
    args: SendSessionPromptArgs,
) -> Result<(), String> {
    if state.protocol_hub.has_session(&args.pane_id) {
        return state
            .protocol_hub
            .send_prompt(&args.pane_id, args.text);
    }
    let reg = state.registry.lock();
    let pane = reg
        .panes
        .get(&args.pane_id)
        .ok_or_else(|| format!("unknown pane: {}", args.pane_id))?;
    if pane.info.agent_type != "opencode_native" {
        return Err("chat composer only routes to opencode_native API today".into());
    }
    let link = pane
        .opencode
        .as_ref()
        .ok_or_else(|| "pane has no opencode link".to_string())?;
    let base = link.base_url.clone();
    let session_id = link.session_id.clone();
    let directory = link.directory.clone();
    drop(reg);
    crate::opencode::client::prompt_async(
        &base,
        &session_id,
        Some(directory.as_str()),
        &args.text,
        None,
    )
        .map_err(|e| format!("{e:?}"))?;
    Ok(())
}

#[derive(Deserialize)]
pub struct ReadOpenCodeMessagesArgs {
    pub pane_id: String,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub role: Option<String>,
}

#[tauri::command]
pub async fn read_opencode_messages(
    state: State<'_, AppState>,
    args: ReadOpenCodeMessagesArgs,
) -> Result<crate::opencode::messages::SessionMessagesView, String> {
    let limit = args.limit.unwrap_or(40).clamp(1, 200);
    crate::opencode::messages::read_pane_messages(
        &state.registry,
        &args.pane_id,
        limit,
        args.role.as_deref(),
    )
}

#[tauri::command]
pub async fn list_opencode_permissions(
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<Vec<crate::opencode::OpenCodePermission>, String> {
    crate::opencode::list_pane_permissions(&state.registry, &pane_id)
}

#[derive(Deserialize)]
pub struct ReplyOpenCodeQuestionArgs {
    pub pane_id: String,
    pub answer: String,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[tauri::command]
pub async fn reply_opencode_question(
    state: State<'_, AppState>,
    args: ReplyOpenCodeQuestionArgs,
) -> Result<Value, String> {
    crate::opencode::reply_pane_question(
        &state.registry,
        &args.pane_id,
        &args.answer,
        args.request_id.as_deref(),
    )
}

#[derive(Deserialize)]
pub struct ReplyOpenCodePermissionArgs {
    pub pane_id: String,
    pub request_id: String,
    pub reply: String,
}

#[tauri::command]
pub async fn reply_opencode_permission(
    state: State<'_, AppState>,
    args: ReplyOpenCodePermissionArgs,
) -> Result<(), String> {
    crate::opencode::reply_pane_permission(
        &state.registry,
        &args.pane_id,
        &args.request_id,
        &args.reply,
    )
}

#[tauri::command]
pub fn session_capabilities(
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<Capabilities, String> {
    Ok(state.protocol_hub.capabilities(&pane_id))
}

#[tauri::command]
pub fn session_history(
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<Vec<AgentEventEnvelope>, String> {
    Ok(state.protocol_hub.history(&pane_id))
}

#[derive(Deserialize)]
pub struct SessionSendPromptArgs {
    pub pane_id: String,
    pub text: String,
}

#[tauri::command]
pub async fn session_send_prompt(
    state: State<'_, AppState>,
    args: SessionSendPromptArgs,
) -> Result<(), String> {
    state.protocol_hub.send_prompt(&args.pane_id, args.text)
}

#[derive(Deserialize)]
pub struct SessionRespondApprovalArgs {
    pub pane_id: String,
    pub approval_id: String,
    pub decision: String,
}

#[tauri::command]
pub async fn session_respond_approval(
    state: State<'_, AppState>,
    args: SessionRespondApprovalArgs,
) -> Result<(), String> {
    state
        .protocol_hub
        .respond_approval(&args.pane_id, &args.approval_id, &args.decision)
}

#[tauri::command]
pub async fn session_cancel_turn(
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<(), String> {
    state.protocol_hub.cancel_turn(&pane_id)
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn list_agents(state: State<'_, AppState>) -> Result<AgentsListResponse, String> {
    Ok(state.agents.list_response())
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
    let agent_type = args.agent_type.clone();
    let surface = args.surface.clone();
    let pane_id = registry_spawn_pane(
        &state.registry,
        &state.agents,
        &app,
        args,
        Some(&state.session_states),
    )?;
    if agent_type == "opencode_native" {
        crate::opencode::protocol::register_pane_protocol(
            &state.protocol_hub,
            &state.registry,
            &pane_id,
        )?;
    } else if agent_type == "codex" {
        let has_dual = {
            let reg = state.registry.lock();
            reg.panes
                .get(&pane_id)
                .map(|p| p.codex.is_some())
                .unwrap_or(false)
        };
        if has_dual {
            crate::codex::protocol::register_pane_protocol(
                &state.protocol_hub,
                &state.registry,
                &pane_id,
            )?;
        }
    } else if agent_type == "claude" && surface.as_deref() == Some("headless") {
        register_claude_headless_protocol(&state, &pane_id)?;
    }
    Ok(pane_id)
}

fn register_claude_headless_protocol(state: &AppState, pane_id: &str) -> Result<(), String> {
    let session_id = crate::session::claude_headless::claude_session_id(&state.registry, pane_id)?;
    let cwd = {
        let reg = state.registry.lock();
        reg.panes
            .get(pane_id)
            .map(|p| p.info.cwd.clone())
            .ok_or_else(|| format!("unknown pane: {pane_id}"))?
    };
    let adapter = crate::protocol::adapter_for(crate::agents::ProtocolKind::ClaudeStreamJson)
        .ok_or_else(|| "claude-stream-json adapter missing".to_string())?;
    state.protocol_hub.register(
        pane_id.to_string(),
        adapter,
        crate::protocol::Endpoint {
            url: String::new(),
            session_id: Some(session_id),
            cwd: Some(cwd),
        },
    )?;
    if let Some(pid) = state.protocol_hub.protocol_child_pid(pane_id) {
        let mut reg = state.registry.lock();
        if let Some(pane) = reg.panes.get_mut(pane_id) {
            crate::process::assign_pid_to_pane_job(&pane.process_tree, pid);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn session_open_in_tui(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<String, String> {
    let session_id =
        crate::session::claude_headless::claude_session_id(&state.registry, &pane_id)?;
    let cwd = {
        let reg = state.registry.lock();
        reg.panes
            .get(&pane_id)
            .map(|p| p.info.cwd.clone())
            .ok_or_else(|| format!("unknown pane: {pane_id}"))?
    };
    let manifest = state
        .agents
        .get("claude")
        .ok_or_else(|| "missing claude manifest".to_string())?;
    let resume = manifest
        .launch_resume_args()
        .ok_or_else(|| "claude manifest missing launch.resume".to_string())?;
    let extra_args = crate::session::substitute_args(resume, 0, "", &session_id, &cwd);
    let new_pane_id = registry_spawn_pane(
        &state.registry,
        &state.agents,
        &app,
        SpawnPaneArgs {
            agent_type: "claude".to_string(),
            cwd: Some(cwd),
            cols: None,
            rows: None,
            extra_args: Some(extra_args),
            pane_id: None,
            surface: None,
        },
        None,
    )?;
    Ok(new_pane_id)
}

#[tauri::command]
pub async fn kill_pane_cmd(
    app: AppHandle,
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<(), String> {
    state.protocol_hub.unregister(&pane_id);
    registry_kill_pane(&state.registry, &pane_id)?;
    let _ = app.emit("pty://panes-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn kill_all_panes(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let ids: Vec<String> = state.registry.lock().panes.keys().cloned().collect();
    for id in ids {
        state.protocol_hub.unregister(&id);
    }
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

#[derive(Serialize)]
pub struct BridgeSessionInfo {
    pub base_url: String,
    pub token: String,
}

#[tauri::command]
pub fn get_bridge_session() -> Result<BridgeSessionInfo, String> {
    let (base_url, token) = crate::bridge::bridge_session()
        .ok_or_else(|| "bridge not started".to_string())?;
    Ok(BridgeSessionInfo { base_url, token })
}
