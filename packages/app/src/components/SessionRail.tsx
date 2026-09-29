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
import { formatPaneSubtitle } from '../lib/session-subtitle';
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
  embedded,
  paneCwds,
}: {
  states: Map<string, SessionRailState>;
  agentCatalog: AgentCatalog;
  paneTitles: Map<string, string>;
  paneCwds?: Map<string, string>;
  selectedPaneId: string | null;
  connecting?: boolean;
  onSelect: (paneId: string) => void;
  embedded?: boolean;
}) {
  const rows = sortRows([...states.values()]);

  const shellClass = embedded
    ? 'w-full flex flex-col min-h-0 flex-1 border-r-0'
    : 'w-52 shrink-0 border-r border-border-subtle bg-surface flex flex-col min-h-0';

  return (
    <aside className={shellClass} aria-label="Sessions" data-testid="session-rail">
      <div className="px-3 h-7 flex items-center border-b border-border-subtle">
        <span className="text-section-label text-text-3">Sessions</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {connecting && rows.length === 0 && (
          <p className="text-meta text-text-3 px-3 py-2">Connecting to session feed…</p>
        )}
        {!connecting && rows.length === 0 && (
          <p className="text-meta text-text-3 px-3 py-2">No sessions yet.</p>
        )}
        {rows.map((row) => {
          const status: DisplayStatus = mergePaneAndSessionStatus(null, row.state);
          const selected = row.pane_id === selectedPaneId;
          const title = sessionTitle(row, agentCatalog, paneTitles);
          const agentLabel = row.agent_type
            ? getPreset(agentCatalog, row.agent_type as never)?.label ?? row.agent_type
            : 'Agent';
          const subtitle = formatPaneSubtitle(
            row.pane_id,
            agentLabel,
            paneCwds?.get(row.pane_id) ?? undefined,
          );

          return (
            <button
              key={row.pane_id}
              type="button"
              onClick={() => onSelect(row.pane_id)}
              className={`w-full text-left px-2 py-1 mx-1 max-w-[calc(100%-0.5rem)] rounded-sm border-l-2 transition-colors duration-ui focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${displayStatusRailAccentClass(status)} ${displayStatusRailSurfaceClass(status, selected)}`}
              title={row.detail ?? row.pane_id}
            >
              <div className="flex items-center gap-2 min-w-0">
                <DisplayStatusDot status={status} pulse={status === 'needs_approval'} />
                <span className="text-meta font-medium text-text truncate flex-1">{title}</span>
                <span className={`text-[10px] shrink-0 ${displayStatusTextClass(status)}`}>
                  {DISPLAY_STATUS_LABEL[status]}
                </span>
              </div>
              <div className="pl-[18px] text-[10px] text-text-3 truncate">{subtitle}</div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
