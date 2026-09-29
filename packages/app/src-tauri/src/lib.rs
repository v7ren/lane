pub mod agents;
mod app_lifecycle;
pub mod protocol;
pub mod session;
pub mod codex;
mod app_paths;
mod bridge;
mod bridge_auth;
mod commands;
mod events;
pub mod opencode;
mod platform;
pub mod process;
mod project_path;
pub mod pty;
mod settings_store;
pub mod shell_env;

use commands::AppState;
use tauri::{Listener, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    shell_env::apply_to_process();
    process::init_application_job();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                tracing_subscriber::EnvFilter::new("info,loomria_app_lib=debug")
            }),
        )
        .with_target(false)
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::list_panes,
            commands::spawn_pane,
            commands::kill_pane_cmd,
            commands::kill_all_panes,
            commands::write_pane_input,
            commands::read_pane_buffer,
            commands::read_pane_snapshot,
            commands::read_pane_raw_buffer,
            commands::switch_agent_model,
            commands::resize_pane,
            commands::set_project_path,
            commands::get_project_path_cmd,
            commands::push_chat_event,
            commands::push_settings_event,
            commands::sync_public_settings,
            app_lifecycle::get_app_install_info,
            app_lifecycle::open_external_url,
            app_lifecycle::launch_uninstall,
            commands::exit_app,
            commands::get_opencode_key_status,
            commands::set_opencode_automation_settings,
            commands::set_opencode_key_settings,
            commands::set_opencode_key_profile,
            commands::capture_opencode_key_profile,
            commands::rotate_opencode_key,
            commands::get_bridge_session,
            commands::list_agents,
            commands::list_resumable_sessions,
            commands::send_session_prompt,
            commands::session_capabilities,
            commands::session_history,
            commands::session_send_prompt,
            commands::session_respond_approval,
            commands::session_cancel_turn,
            commands::session_open_in_tui,
            commands::read_opencode_messages,
            commands::list_opencode_permissions,
            commands::reply_opencode_question,
            commands::reply_opencode_permission,
            commands::opencode_request,
            commands::opencode_server_info,
            commands::opencode_select_tui_session,
        ])
        .setup(|app| {
            let port_file = app_paths::bridge_port_file();
            let _ = app_paths::ensure_app_data_dir();

            let state = app.state::<AppState>();
            let registry = state.registry.clone();
            let agents = state.agents.clone();
            if let Err(err) =
                bridge::start_embedded_bridge(registry, agents, app.handle().clone(), port_file)
            {
                tracing::warn!(%err, "embedded bridge not started");
            }

            let session_store = app.state::<AppState>().session_states.clone();
            let protocol_hub = app.state::<AppState>().protocol_hub.clone();
            protocol_hub.bind_app(app.handle().clone(), session_store.clone());
            crate::opencode::sse_hub::bind_app(app.handle().clone());
            session::spawn_state_monitor(session_store);

            app.handle().listen("terminal-data", move |event| {
                let payload = event.payload();
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                    let pane_id = value.get("pane_id").and_then(|v| v.as_str()).unwrap_or("");
                    let data = value.get("data").and_then(|v| v.as_array());
                    if !pane_id.is_empty() {
                        if let Some(bytes) = data {
                            let raw: Vec<u8> = bytes
                                .iter()
                                .filter_map(|v| v.as_u64().map(|n| n as u8))
                                .collect();
                            bridge::push_terminal_sse(pane_id, &raw);
                        }
                    }
                }
            });

            let registry_for_panes = app.state::<AppState>().registry.clone();
            app.handle().listen("pty://panes-changed", move |_event| {
                bridge::push_panes_sse(&registry_for_panes);
            });

            app.handle().listen("pty://status", |event| {
                let payload = event.payload();
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
                    let pane_id = value.get("pane_id").and_then(|v| v.as_str()).unwrap_or("");
                    let status = value.get("status").and_then(|v| v.as_str()).unwrap_or("");
                    if !pane_id.is_empty() && !status.is_empty() {
                        bridge::push_pane_status_sse(pane_id, status);
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app_handle.try_state::<AppState>() {
                    pty::registry_kill_all(&state.registry);
                }
            }
        });
}
