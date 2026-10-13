import { z } from 'zod';

export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string(),
  tool_calls: z.array(z.object({
    id: z.string(),
    name: z.string(),
    args: z.unknown(),
  })).optional(),
  tool_call_id: z.string().optional(),
  timestamp: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const LlmProviderSchema = z.enum(['anthropic', 'openai', 'openrouter']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmModelSchema = z.object({
  provider: LlmProviderSchema,
  model_id: z.string().min(1),
  label: z.string().min(1),
});
export type LlmModel = z.infer<typeof LlmModelSchema>;

/** How the Loomria sidebar drives orchestration. */
export const OrchestratorBackendSchema = z.enum([
  'api',           // Direct LLM API + in-process MCP tool loop (current)
  'claude_cli',    // Dedicated Claude Code pane with MCP configured
  'codex_cli',     // Dedicated Codex CLI pane with MCP configured
  'opencode_cli',  // Dedicated OpenCode pane with MCP configured
]);
export type OrchestratorBackend = z.infer<typeof OrchestratorBackendSchema>;

export const ORCHESTRATOR_BACKEND_LABELS: Record<OrchestratorBackend, string> = {
  api: 'LLM API (direct)',
  claude_cli: 'Claude Code CLI',
  codex_cli: 'Codex CLI',
  opencode_cli: 'OpenCode CLI',
};

export function modelKey(model: Pick<LlmModel, 'provider' | 'model_id'>): string {
  return `${model.provider}::${model.model_id}`;
}

export function parseModelKey(key: string): { provider: LlmProvider; model_id: string } | null {
  const idx = key.indexOf('::');
  if (idx <= 0) return null;
  const provider = key.slice(0, idx);
  const model_id = key.slice(idx + 2);
  const parsed = LlmProviderSchema.safeParse(provider);
  if (!parsed.success || !model_id) return null;
  return { provider: parsed.data, model_id };
}

export const DEFAULT_LLM_MODELS: LlmModel[] = [
  { provider: 'anthropic', model_id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { provider: 'anthropic', model_id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { provider: 'openai', model_id: 'gpt-4.1', label: 'GPT-4.1' },
  { provider: 'openai', model_id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
  { provider: 'openrouter', model_id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4 (OR)' },
  { provider: 'openrouter', model_id: 'openai/gpt-4.1', label: 'GPT-4.1 (OR)' },
  { provider: 'openrouter', model_id: 'google/gemini-2.5-flash-preview', label: 'Gemini 2.5 Flash (OR)' },
  { provider: 'openrouter', model_id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (OR)' },
];

export const ShellLayoutSchema = z.object({
  activityRailWidth: z.number().int().min(40).max(64).default(48),
  sidebarWidth: z.number().int().min(160).max(400).default(220),
  explorerWidth: z.number().int().min(160).max(400).default(240),
  rightRailWidth: z.number().int().min(200).max(480).default(300),
  bottomPanelPercent: z.number().min(20).max(80).default(70),
  sidebarCollapsed: z.boolean().default(false),
  explorerCollapsed: z.boolean().default(false),
  rightRailCollapsed: z.boolean().default(false),
  bottomPanelCollapsed: z.boolean().default(false),
});
export type ShellLayout = z.infer<typeof ShellLayoutSchema>;

export const SettingsSchema = z.object({
  anthropic_api_key: z.string().optional(),
  openai_api_key: z.string().optional(),
  openrouter_api_key: z.string().optional(),
  default_provider: LlmProviderSchema.default('anthropic'),
  default_model: z.string().default('claude-sonnet-4-6'),
  /** User-defined models merged with presets in the sidebar picker. */
  custom_models: z.array(LlmModelSchema).default([]),
  /** Sidebar orchestration backend. API runs an in-process tool loop; CLI modes delegate to live agent panes. */
  orchestrator_backend: OrchestratorBackendSchema.default('api'),
  /** Stable pane id for the dedicated orchestrator CLI pane (CLI backends). */
  orchestrator_pane_id: z.string().optional(),
  project_path: z.string().optional(),
  /** Orchestrator sidebar width in the workspace (px). */
  sidebar_width: z.number().int().min(300).max(800).default(360),
  /** Desktop UI chrome theme. */
  theme: z.enum(['dark', 'light']).default('dark'),
  /** Desktop shell layout: agent-first conversation surface, or the full IDE workspace. */
  ui_mode: z.enum(['agent', 'ide']).default('agent'),
  /** Developer option: install MCP configs to launch the bundled Rust binary instead of npm. */
  developer_use_rust_mcp: z.boolean().default(false),
  /** UI accent colour (#RRGGBB); unset means the default blue. */
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Rebound shortcuts by action id (combo strings like "Ctrl+Shift+L"); unset means defaults. */
  keybinds: z.record(z.string(), z.string()).optional(),
  /** Optional path to the librarian project indexer script (default scripts/project-indexer.py). */
  librarian_indexer_path: z.string().optional(),
  /** Default OpenCode provider for opencode_native API prompts (write_terminal_input). */
  opencode_model_provider: z.string().optional(),
  /** Default OpenCode model for opencode_native API prompts (write_terminal_input). */
  opencode_model_id: z.string().optional(),
  /** Resizable app shell panel sizes and collapse state. */
  shell_layout: ShellLayoutSchema.optional(),
});
export type Settings = z.infer<typeof SettingsSchema>;
