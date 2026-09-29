import type { SessionRailState } from '../hooks/useSessionRail';

const LABEL: Record<string, string> = {
  needs_approval: 'Needs approval',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
  error: 'Error',
  rate_limited: 'Rate limited',
};

export function SessionRail({ states }: { states: Map<string, SessionRailState> }) {
  const rows = [...states.values()].sort((a, b) => b.updated_at_ms - a.updated_at_ms);
  if (rows.length === 0) return null;

  return (
    <div className="flex gap-2 px-3 py-1 border-b border-pm-border bg-pm-panel/80 text-xs overflow-x-auto shrink-0">
      {rows.map((row) => (
        <span
          key={row.pane_id}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-pm-border whitespace-nowrap"
          title={row.detail ?? row.pane_id}
        >
          <span className="font-mono text-pm-muted">{row.pane_id.slice(0, 8)}</span>
          <span>{LABEL[row.state] ?? row.state}</span>
        </span>
      ))}
    </div>
  );
}
