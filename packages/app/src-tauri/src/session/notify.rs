//! Session state transitions worth surfacing — notifications are decided in the UI.

use super::state::{SessionStateKind, SessionStateSnapshot};

pub fn maybe_notify(snap: &SessionStateSnapshot) {
    let title = match snap.state {
        SessionStateKind::NeedsApproval => "approval needed",
        SessionStateKind::Done => "session done",
        _ => return,
    };
    tracing::info!(
        title,
        pane = %snap.pane_id,
        agent = ?snap.agent_type,
        detail = ?snap.detail,
        "session notification (UI handles desktop notify)"
    );
}
