import type { AgentFamily } from './agent-capabilities';

export const CLAUDE_DEFAULT_CONTEXT = 200_000;
export const CLAUDE_LONG_CONTEXT = 1_000_000;

/**
 * Context window for the context bar. The window reported by the event wins; otherwise Claude
 * falls back to its model id (`[1m]` suffix means 1M tokens, anything else 200k) and OpenCode to
 * the provider catalog `limit.context`. Codex reports its own window; unknown means no bar.
 */
export function resolveContextWindow(opts: {
  family: AgentFamily;
  model?: string | null;
  eventWindow?: number | null;
  catalogLimit?: number | null;
}): number | undefined {
  const { family, model, eventWindow, catalogLimit } = opts;
  if (typeof eventWindow === 'number' && eventWindow > 0) return eventWindow;
  if (family === 'claude') {
    return model && /\[1m\]$/i.test(model) ? CLAUDE_LONG_CONTEXT : CLAUDE_DEFAULT_CONTEXT;
  }
  if (family === 'opencode' && typeof catalogLimit === 'number' && catalogLimit > 0) return catalogLimit;
  return undefined;
}
