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
mod ports;
pub mod process;
mod project_path;
mod fs_scoped;
mod git_info;
pub mod pty;
mod settings_persist;
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
            commands::get_persisted_project_path_cmd,
            commands::push_chat_event,
            commands::push_settings_event,
            commands::sync_public_settings,
            app_lifecycle::get_app_install_info,
            git_info::git_status_summary,
            git_info::git_diff_files,
            ports::ports_report,
            ports::ports_get_config,
            ports::ports_set_config,
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
            commands::session_agent_info,
            commands::session_set_option,
            commands::session_open_in_tui,
            commands::session_claude_to_chat,
            commands::session_post_notice,
            commands::claude_list_sessions,
            commands::read_opencode_messages,
            commands::list_opencode_permissions,
            commands::reply_opencode_question,
            commands::reply_opencode_permission,
            commands::opencode_request,
            commands::opencode_server_info,
            commands::opencode_select_tui_session,
            fs_scoped::fs_list_dir,
            fs_scoped::fs_read_file,
            fs_scoped::fs_write_file,
            fs_scoped::fs_stat,
            fs_scoped::fs_create,
            fs_scoped::fs_rename,
            fs_scoped::fs_delete,
            fs_scoped::fs_walk_files,
            fs_scoped::fs_start_watcher,
        ])
        .setup(|app| {
            let port_file = app_paths::bridge_port_file();
            let _ = app_paths::ensure_app_data_dir();

            let mut webview_origins = vec![
                "http://tauri.localhost".to_string(),
                "https://tauri.localhost".to_string(),
                "tauri://localhost".to_string(),
            ];
            if cfg!(debug_assertions) {
                if let Some(dev_url) = &app.config().build.dev_url {
                    if let Some(origin) = bridge_auth::origin_from_dev_url(dev_url.as_str()) {
                        webview_origins.push(origin.clone());
                        if origin.contains("127.0.0.1") {
                            webview_origins.push(origin.replace("127.0.0.1", "localhost"));
                        } else if origin.contains("localhost") {
                            webview_origins.push(origin.replace("localhost", "127.0.0.1"));
                        }
                    }
                }
            }
            let _ = bridge_auth::set_allowed_webview_origins(webview_origins);

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
