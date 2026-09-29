//! Register OpenCode native panes with the universal protocol hub.

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
    let (base_url, session_id, directory) = {
        let reg = registry.lock();
        let pane = reg
            .panes
            .get(pane_id)
            .ok_or_else(|| format!("unknown pane: {pane_id}"))?;
        let link = pane
            .opencode
            .as_ref()
            .ok_or_else(|| format!("pane {pane_id} has no opencode link"))?;
        (
            link.base_url.clone(),
            link.session_id.clone(),
            link.directory.clone(),
        )
    };
    let adapter = adapter_for(ProtocolKind::OpencodeHttp)
        .ok_or_else(|| "opencode-http adapter missing".to_string())?;
    hub.register(
        pane_id.to_string(),
        adapter,
        Endpoint {
            url: base_url,
            session_id: Some(session_id),
            cwd: Some(directory),
        },
    )
}
