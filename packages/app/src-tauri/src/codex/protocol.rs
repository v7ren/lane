//! Register Codex dual panes with the universal protocol hub.

use crate::agents::ProtocolKind;
use crate::protocol::{adapter_for, Endpoint};
use crate::session::ProtocolHub;
use crate::pty::registry::PaneRegistry;
use parking_lot::Mutex;
use std::sync::Arc;

pub fn register_pane_protocol(
    hub: &Arc<ProtocolHub>,
    registry: &Arc<Mutex<PaneRegistry>>,
    pane_id: &str,
) -> Result<(), String> {
    let (ws_url, thread_id, cwd) = {
        let reg = registry.lock();
        let pane = reg
            .panes
            .get(pane_id)
            .ok_or_else(|| format!("unknown pane: {pane_id}"))?;
        let link = pane
            .codex
            .as_ref()
            .ok_or_else(|| format!("pane {pane_id} has no codex link"))?;
        (link.ws_url.clone(), link.thread_id.clone(), link.cwd.clone())
    };
    let adapter = adapter_for(ProtocolKind::CodexAppServer)
        .ok_or_else(|| "codex-app-server adapter missing".to_string())?;
    hub.register(
        pane_id.to_string(),
        adapter,
        Endpoint {
            url: ws_url,
            session_id: Some(thread_id),
            cwd: Some(cwd),
            codex: None,
        },
    )
}
