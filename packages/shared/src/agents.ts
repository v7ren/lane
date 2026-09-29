export interface ManifestFileError {
  file: string;
  message: string;
}

export interface AgentCatalog {
  agents: AgentManifestSummary[];
  report: { errors: ManifestFileError[] };
}

export interface AgentManifestSummary {
  id: string;
  label: string;
  description: string;
  icon: string;
  is_tui: boolean;
  command: string;
  base_args: string[];
  show_in_new_pane_menu: boolean;
  default_worker: boolean;
  spawn_handler?: string | null;
}

/** Manifest id (formerly the fixed `AgentType` enum). */
export type AgentId = string;

/** @deprecated use `AgentId` — kept for incremental UI migration. */
export type AgentType = AgentId;

export interface AgentPreset {
  type: AgentId;
  label: string;
  description: string;
  command: string;
  baseArgs: string[];
  isTui: boolean;
  icon: string;
}

function summaryToPreset(summary: AgentManifestSummary): AgentPreset {
  return {
    type: summary.id,
    label: summary.label,
    description: summary.description,
    command: summary.command,
    baseArgs: summary.base_args,
    isTui: summary.is_tui,
    icon: summary.icon,
  };
}

export function emptyAgentCatalog(): AgentCatalog {
  return { agents: [], report: { errors: [] } };
}

export function listPresets(catalog: AgentCatalog): AgentPreset[] {
  return catalog.agents.map(summaryToPreset);
}

export function listLaunchPresets(catalog: AgentCatalog): AgentPreset[] {
  return catalog.agents.filter((agent) => agent.show_in_new_pane_menu).map(summaryToPreset);
}

export function getPreset(catalog: AgentCatalog, id: string): AgentPreset | undefined {
  const summary = catalog.agents.find((agent) => agent.id === id);
  return summary ? summaryToPreset(summary) : undefined;
}

export function getDefaultTerminalAgentType(catalog: AgentCatalog): AgentId {
  return (
    catalog.agents.find((agent) => agent.default_worker)?.id ??
    catalog.agents[0]?.id ??
    'opencode_native'
  );
}

export function getAgentPresets(catalog: AgentCatalog): Record<string, AgentPreset> {
  return Object.fromEntries(listPresets(catalog).map((preset) => [preset.type, preset]));
}
