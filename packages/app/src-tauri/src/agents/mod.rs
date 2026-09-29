mod catalog;
mod manifest;
mod observe;

pub use catalog::{
    AgentCatalog, AgentManifestSummary, AgentsListResponse, ManifestFileError,
    ManifestLoadReport, resolve_tui_for_id,
};
pub use manifest::{AgentManifest, ProtocolKind, SpawnHandler};
pub use observe::observe_agent_output;
