import { useCallback, useMemo } from 'react';
import type { AgentFamily } from '../lib/agent-capabilities';
import { sessionSetOption } from '../lib/agent-session';
import { CLAUDE_PERMISSION_MODES, useClaudeInfo, type ClaudeInfo } from '../lib/claude-info';

export type ControlChoice = { id: string; label: string; detail?: string; warning?: boolean };

export type AgentControls = {
  models: ControlChoice[];
  currentModel?: string;
  modes: ControlChoice[];
  currentMode?: string;
  efforts?: { id: string; label: string }[];
  currentEffort?: string;
  setModel(id: string): Promise<void>;
  setMode(id: string): Promise<void>;
  setEffort?(id: string): Promise<void>;
  disabledReason?: string;
  /** Claude's `initialize` reply, for header chips and the account label. */
  claudeInfo?: ClaudeInfo | null;
  /** Mirrors a change made elsewhere (for example plan approval) into the Claude pills. */
  patchClaudeInfo?: (patch: Partial<Pick<ClaudeInfo, 'permissionMode' | 'model'>>) => void;
};

const NOOP = async (): Promise<void> => {};

export const EMPTY_AGENT_CONTROLS: AgentControls = {
  models: [],
  modes: [],
  setModel: NOOP,
  setMode: NOOP,
};

/**
 * Model and mode choices for the composer toolbar, one shape for every agent.
 * Claude reads them from its `initialize` reply. Codex stays empty until D3. OpenCode keeps its
 * own provider catalog and permission prefs inside the composer, so it is empty here too.
 */
export function useAgentControls(opts: {
  paneId: string;
  family: AgentFamily;
  /** True when the pane is a protocol (hub) pane. */
  protocol: boolean;
  onError?: (message: string | null) => void;
  disabledReason?: string;
}): AgentControls {
  const { paneId, family, protocol, onError, disabledReason } = opts;
  const { info, update } = useClaudeInfo(paneId, family === 'claude' && protocol);

  const setOption = useCallback(
    async (key: 'model' | 'permission_mode', value: string) => {
      onError?.(null);
      try {
        await sessionSetOption(paneId, key, value);
        update(key === 'model' ? { model: value } : { permissionMode: value });
      } catch (err) {
        onError?.(err instanceof Error ? err.message : String(err));
      }
    },
    [onError, paneId, update],
  );
  const setModel = useCallback((id: string) => setOption('model', id), [setOption]);
  const setMode = useCallback((id: string) => setOption('permission_mode', id), [setOption]);

  return useMemo(() => {
    if (family !== 'claude' || !protocol) return EMPTY_AGENT_CONTROLS;
    return {
      models: (info?.models ?? []).map((m) => ({ id: m.value, label: m.displayName, detail: m.description })),
      currentModel: info ? (info.model ?? 'default') : undefined,
      modes: CLAUDE_PERMISSION_MODES.map((m) => ({ id: m.id, label: m.label, detail: m.detail })),
      currentMode: info?.permissionMode,
      setModel,
      setMode,
      disabledReason,
      claudeInfo: info,
      patchClaudeInfo: update,
    };
  }, [disabledReason, family, info, protocol, setMode, setModel, update]);
}
