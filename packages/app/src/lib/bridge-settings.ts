import type { OrchestratorBackend, Settings } from '@loomria/shared';

/** Settings fields exposed over the HTTP bridge (no API keys). */
export type PublicSettings = Pick<
  Settings,
  | 'orchestrator_backend'
  | 'default_provider'
  | 'default_model'
  | 'opencode_model_provider'
  | 'opencode_model_id'
  | 'developer_use_rust_mcp'
  | 'librarian_indexer_path'
>;

export function toPublicSettings(settings: Settings): PublicSettings {
  return {
    orchestrator_backend: settings.orchestrator_backend ?? 'api',
    default_provider: settings.default_provider ?? 'anthropic',
    default_model: settings.default_model ?? 'claude-sonnet-4-6',
    opencode_model_provider: settings.opencode_model_provider?.trim() || undefined,
    opencode_model_id: settings.opencode_model_id?.trim() || undefined,
    developer_use_rust_mcp: settings.developer_use_rust_mcp ?? false,
    librarian_indexer_path: settings.librarian_indexer_path?.trim() || undefined,
  };
}

export const DEFAULT_PUBLIC_SETTINGS: PublicSettings = {
  orchestrator_backend: 'api',
  default_provider: 'anthropic',
  default_model: 'claude-sonnet-4-6',
  opencode_model_provider: undefined,
  opencode_model_id: undefined,
  developer_use_rust_mcp: false,
  librarian_indexer_path: undefined,
};

export function isOrchestratorBackend(value: string): value is OrchestratorBackend {
  return (
    value === 'api' ||
    value === 'claude_cli' ||
    value === 'codex_cli' ||
    value === 'opencode_cli'
  );
}
