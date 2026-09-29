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
import type { DisplayStatus } from '../lib/display-status';
import { DisplayStatusDot } from './DisplayStatusDot';

interface Props {
  agentCatalog: AgentCatalog;
  pane: PaneData;
  subscribePaneData: (paneId: string, cb: (data: Uint8Array) => void) => () => void;
  onClose: (paneId: string) => void;
  onPopOut?: (paneId: string, size?: { width: number; height: number }) => void;
  onSwitchAgent: (paneId: string, agentType: AgentId) => void | Promise<void>;
  onOpenAgent?: (paneId: string) => void;
  reflowKey?: number | string;
  displayStatus?: DisplayStatus;
  compactChrome?: boolean;
}

function switchPresetsFor(catalog: AgentCatalog, agent: AgentId): AgentPreset[] {
  const launchPresets = listLaunchPresets(catalog);
  if (launchPresets.some((preset) => preset.type === agent)) {
    return launchPresets;
  }
  const current = getPreset(catalog, agent);
  return current ? [current, ...launchPresets] : launchPresets;
}

function paneDisplayStatus(pane: PaneData, override?: DisplayStatus): DisplayStatus {
  if (override) return override;
  if (pane.status === 'waiting_input') return 'needs_approval';
  if (pane.status === 'running') return 'working';
  if (pane.status === 'error') return 'error';
  return 'idle';
}

export function TerminalPane({
  agentCatalog,
  pane,
  subscribePaneData,
  onClose,
  onPopOut,
  onSwitchAgent,
  onOpenAgent,
  reflowKey,
  displayStatus,
  compactChrome = false,
}: Props) {
  const [switching, setSwitching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { containerRef } = useTerminalSession({
    paneId: pane.info.id,
    sessionKey: pane.info.created_at,
    subscribePaneData,
    reflowKey,
  });

  const agent = pane.info.agent_type;
  const presets = switchPresetsFor(agentCatalog, agent);
  const preset = presets.find((p) => p.type === agent);
  const status = paneDisplayStatus(pane, displayStatus);

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
    <div
      ref={rootRef}
      className="flex flex-col h-full rounded-lg border border-lr-border bg-lr-bg overflow-hidden relative"
    >
      {switching && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-lr-bg/80 text-xs text-lr-muted">
          Switching agent…
        </div>
      )}
      {!compactChrome && (
        <div className="flex items-center gap-2 px-2 py-1 border-b border-lr-border bg-lr-panel text-xs text-lr-text">
          <DisplayStatusDot status={status} pulse={status === 'needs_approval'} />
          <select
            className="bg-lr-bg border border-lr-border rounded px-1 py-0.5 text-xs disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-lr-accent/40"
            value={agent}
            disabled={switching}
            aria-label="Agent type"
            onChange={(e) => void handleAgentChange(e.target.value as AgentId)}
          >
            {presets.map((p) => (
              <option key={p.type} value={p.type}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-lr-muted truncate" title={pane.info.cwd}>
            {preset?.label ?? pane.info.agent_type} · pid {pane.info.pid}
          </span>
          <div className="flex-1" />
          {onOpenAgent && (
            <button
              type="button"
              className="px-1.5 py-0.5 rounded text-lr-muted hover:text-lr-text hover:bg-lr-border/40"
              title="Open Agent Mode"
              onClick={() => onOpenAgent(pane.info.id)}
            >
              Agent
            </button>
          )}
          {onPopOut && (
            <button
              className="px-1.5 py-0.5 rounded text-lr-muted hover:text-lr-text hover:bg-lr-border/40"
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
            className="px-1.5 py-0.5 rounded text-lr-muted hover:text-lr-err hover:bg-lr-err/10"
            title="Kill pane"
            aria-label="Kill pane"
            onClick={() => onClose(pane.info.id)}
          >
            ✕
          </button>
        </div>
      )}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="h-full overflow-hidden terminal-host" />
      </div>
    </div>
  );
}
