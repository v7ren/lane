import { getPreset, type AgentCatalog } from '@loomria/shared';
import type { SessionRailState } from '../hooks/useSessionRail';
import {
  DISPLAY_STATUS_LABEL,
  DISPLAY_STATUS_ORDER,
  displayStatusRailAccentClass,
  displayStatusRailSurfaceClass,
  displayStatusTextClass,
  mergePaneAndSessionStatus,
  type DisplayStatus,
} from '../lib/display-status';
import { DisplayStatusDot } from './DisplayStatusDot';

function sessionTitle(
  row: SessionRailState,
  agentCatalog: AgentCatalog,
  paneTitles: Map<string, string>,
): string {
  const fromPane = paneTitles.get(row.pane_id);
  if (fromPane) return fromPane;
  if (row.agent_type) {
    const preset = getPreset(agentCatalog, row.agent_type as never);
    if (preset) return preset.label;
  }
  return `Session ${row.pane_id.slice(0, 8)}`;
}

function sortRows(rows: SessionRailState[]): SessionRailState[] {
  return [...rows].sort((a, b) => {
    const sa = DISPLAY_STATUS_ORDER[mergePaneAndSessionStatus(null, a.state)] ?? 99;
    const sb = DISPLAY_STATUS_ORDER[mergePaneAndSessionStatus(null, b.state)] ?? 99;
    if (sa !== sb) return sa - sb;
    return b.updated_at_ms - a.updated_at_ms;
  });
}

export function SessionRail({
  states,
  agentCatalog,
  paneTitles,
  selectedPaneId,
  connecting,
  onSelect,
}: {
  states: Map<string, SessionRailState>;
  agentCatalog: AgentCatalog;
  paneTitles: Map<string, string>;
  selectedPaneId: string | null;
  connecting?: boolean;
  onSelect: (paneId: string) => void;
}) {
  const rows = sortRows([...states.values()]);

  return (
    <aside
      className="w-52 shrink-0 border-r border-lr-border bg-lr-panel flex flex-col min-h-0"
      aria-label="Sessions"
    >
      <div className="px-3 py-2 border-b border-lr-border text-[11px] font-semibold uppercase tracking-wide text-lr-muted">
        Sessions
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {connecting && rows.length === 0 && (
          <p className="text-xs text-lr-muted px-2 py-4">Connecting to session feed…</p>
        )}
        {!connecting && rows.length === 0 && (
          <p className="text-xs text-lr-muted px-2 py-4">No active sessions yet.</p>
        )}
        {rows.map((row) => {
          const status: DisplayStatus = mergePaneAndSessionStatus(null, row.state);
          const selected = row.pane_id === selectedPaneId;
          const title = sessionTitle(row, agentCatalog, paneTitles);
          const agentLabel = row.agent_type
            ? getPreset(agentCatalog, row.agent_type as never)?.label ?? row.agent_type
            : 'Agent';

          return (
            <button
              key={row.pane_id}
              type="button"
              onClick={() => onSelect(row.pane_id)}
              className={`w-full text-left rounded-lg px-2 py-2 border border-l-4 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-lr-accent/50 ${displayStatusRailAccentClass(status)} ${displayStatusRailSurfaceClass(status, selected)}`}
              title={row.detail ?? row.pane_id}
            >
              <div className="flex items-center gap-2">
                <DisplayStatusDot status={status} pulse={status === 'needs_approval'} />
                <span className="text-xs font-medium text-lr-text truncate flex-1">{title}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-1 pl-[18px]">
                <span className="text-[10px] text-lr-muted truncate">{agentLabel}</span>
                <span className={`text-[10px] shrink-0 ${displayStatusTextClass(status)}`}>
                  {DISPLAY_STATUS_LABEL[status]}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
