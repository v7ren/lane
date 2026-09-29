//! Desktop notifications for session state (best-effort; mute is handled in the UI).

use super::state::{SessionStateKind, SessionStateSnapshot};
use parking_lot::Mutex;
use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

static APP_HANDLE: OnceLock<Mutex<Option<AppHandle>>> = OnceLock::new();

fn handle_slot() -> &'static Mutex<Option<AppHandle>> {
    APP_HANDLE.get_or_init(|| Mutex::new(None))
}

pub fn set_app_handle(app: AppHandle) {
    *handle_slot().lock() = Some(app);
}

pub fn maybe_notify(snap: &SessionStateSnapshot) {
    let app = handle_slot().lock().clone();
    let Some(app) = app else {
        tracing::debug!(pane = %snap.pane_id, "notification skipped: no app handle");
        return;
    };

    let (title, body) = match snap.state {
        SessionStateKind::NeedsApproval => (
            "Loomria — approval needed",
            snap.detail
                .clone()
                .unwrap_or_else(|| format!("Session {}", snap.pane_id)),
        ),
        SessionStateKind::Done => (
            "Loomria — session done",
            snap.detail
                .clone()
                .unwrap_or_else(|| format!("Session {}", snap.pane_id)),
        ),
        _ => return,
    };

    if let Err(err) = app.notification().builder().title(title).body(body).show() {
        tracing::debug!(error = %err, pane = %snap.pane_id, "notification skipped");
    }
}
