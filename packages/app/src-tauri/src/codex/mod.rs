mod dual;
mod link;
pub mod protocol;

pub use dual::{build_codex_attach_pty_command, spawn_dual_pane};
pub use link::CodexLink;
