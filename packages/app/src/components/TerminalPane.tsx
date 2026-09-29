import { useRef, useState } from 'react';
import {
  getPreset,
  listLaunchPresets,
  type AgentCatalog,
  type AgentId,
  type AgentPreset,
} from '@loomria/shared';
import { useTerminalSession } from '../hooks/useTerminalSession';
import type { PaneData } from '../hooks/usePaneRegistry';

interface Props {
  agentCatalog: AgentCatalog;
  pane: PaneData;
  subscribePaneData: (paneId: string, cb: (data: Uint8Array) => void) => () => void;
  onClose: (paneId: string) => void;
  onPopOut?: (paneId: string, size?: { width: number; height: number }) => void;
  onSwitchAgent: (paneId: string, agentType: AgentId) => Promise<void>;
  onOpenChat?: (paneId: string) => void;
  syncPTYResize?: boolean;
  reflowKey?: number | string;
}

const STATUS_COLOR: Record<string, string> = {
  running: 'bg-pm-ok',
  waiting_input: 'bg-pm-warn',
  idle: 'bg-pm-muted',
  error: 'bg-pm-err',
};

function switchPresetsFor(catalog: AgentCatalog, agent: AgentId): AgentPreset[] {
  const launchPresets = listLaunchPresets(catalog);
  if (launchPresets.some((preset) => preset.type === agent)) {
    return launchPresets;
  }
  const current = getPreset(catalog, agent);
  return current ? [current, ...launchPresets] : launchPresets;
}

export function TerminalPane({
  agentCatalog,
  pane,
  subscribePaneData,
  onClose,
  onPopOut,
  onSwitchAgent,
  onOpenChat,
  syncPTYResize = true,
  reflowKey,
}: Props) {
  const [switching, setSwitching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { containerRef } = useTerminalSession({
    paneId: pane.info.id,
    sessionKey: pane.info.created_at,
    subscribePaneData,
    syncPTYResize,
    reflowKey,
  });

  const agent = pane.info.agent_type;
  const presets = switchPresetsFor(agentCatalog, agent);
  const preset = presets.find((p) => p.type === agent);

  const handleAgentChange = async (next: AgentId) => {
    if (next === agent || switching) return;
    setSwitching(true);
    try {
      await onSwitchAgent(pane.info.id, next);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div ref={rootRef} className="flex flex-col h-full rounded border border-pm-border bg-pm-bg overflow-hidden relative">
      {switching && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-pm-bg/80 text-xs text-pm-muted">
          Switching agent…
        </div>
      )}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-pm-border bg-pm-panel text-xs text-pm-text">
        <span
          className={`inline-block w-2 h-2 rounded-full ${STATUS_COLOR[pane.status] ?? 'bg-pm-muted'}`}
          title={pane.status}
        />
        <select
          className="bg-pm-bg border border-pm-border rounded px-1 py-0.5 text-xs disabled:opacity-50"
          value={agent}
          disabled={switching}
          onChange={(e) => void handleAgentChange(e.target.value)}
        >
          {presets.map((p) => (
            <option key={p.type} value={p.type}>
              {p.label}
            </option>
          ))}
        </select>
        <span className="text-pm-muted truncate" title={pane.info.cwd}>
          {preset?.label ?? pane.info.agent_type} · pid {pane.info.pid}
        </span>
        <div className="flex-1" />
        {onOpenChat && pane.info.agent_type === 'opencode_native' && (
          <button
            type="button"
            className="px-1.5 py-0.5 rounded text-pm-muted hover:text-pm-text hover:bg-pm-border/40"
            title="Open chat composer (API)"
            onClick={() => onOpenChat(pane.info.id)}
          >
            Chat
          </button>
        )}
        {onPopOut && (
          <button
            className="px-1.5 py-0.5 rounded text-pm-muted hover:text-pm-text hover:bg-pm-border/40"
            title="Pop out pane"
            onClick={() => {
              const rect =
                containerRef.current?.getBoundingClientRect() ??
                rootRef.current?.getBoundingClientRect();
              onPopOut(
                pane.info.id,
                rect ? { width: rect.width, height: rect.height } : undefined,
              );
            }}
          >
            ↗
          </button>
        )}
        <button
          className="px-1.5 py-0.5 rounded text-pm-muted hover:text-pm-err hover:bg-pm-err/10"
          title="Kill pane"
          onClick={() => onClose(pane.info.id)}
        >
          ✕
        </button>
      </div>
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="h-full overflow-hidden terminal-host" />
      </div>
    </div>
  );
}
