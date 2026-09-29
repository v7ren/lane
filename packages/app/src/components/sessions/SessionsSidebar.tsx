import { Plus, Search } from 'lucide-react';
import { useMemo } from 'react';
import { useSessionList, useSessionListFilter } from '../../lib/shell-data';
import { useShellSelection } from '../../lib/shell-selection-context';
import { markSessionRead } from '../../lib/sessions/session-read-state';
import { useSessionActions } from '../../lib/sessions/session-actions-context';
import { SessionRow } from './SessionRow';
import { RevertBanner } from './RevertBanner';

export function SessionsSidebar({
  connecting,
  onSelectSession,
}: {
  connecting?: boolean;
  onSelectSession: (paneId: string, sessionId?: string) => void;
}) {
  const { query, setQuery, sortMode, setSortMode } = useSessionListFilter();
  const sessions = useSessionList({ query, sortMode });
  const { selectedPaneId, selectedSessionId } = useShellSelection();
  const actions = useSessionActions();

  const grouped = useMemo(() => {
    const map = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const key = s.workspaceLabel ?? s.workspaceDirectory ?? 'Workspace';
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [sessions]);

  return (
    <div className="flex flex-col min-h-0 h-full bg-surface" data-testid="sidebar-sessions">
      <div className="px-3 h-7 flex items-center justify-between border-b border-border-subtle">
        <span className="text-section-label text-text-3">Sessions</span>
        <button
          type="button"
          aria-label="New OpenCode session"
          className="p-1 rounded-md text-text-3 hover:text-text hover:bg-hover"
          onClick={() => {
            const paneId =
              sessions.find((s) => s.sessionId)?.paneId ?? selectedPaneId ?? sessions[0]?.paneId;
            if (paneId) void actions.createSession(paneId);
          }}
        >
          <Plus size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div className="px-2 py-2 border-b border-border-subtle flex gap-1 items-center">
        <Search size={14} className="text-text-3 shrink-0" strokeWidth={1.5} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions…"
          className="flex-1 bg-transparent text-meta outline-none placeholder:text-text-3"
          data-testid="session-search"
        />
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as 'attention' | 'recent')}
          className="text-[10px] uppercase bg-transparent text-text-3 outline-none"
          aria-label="Sort sessions"
        >
          <option value="attention">Attention</option>
          <option value="recent">Recent</option>
        </select>
      </div>
      <RevertBanner />
      <div className="flex-1 overflow-y-auto py-1">
        {connecting && sessions.length === 0 && (
          <p className="text-meta text-text-3 px-3 py-2">Connecting to session feed…</p>
        )}
        {!connecting && sessions.length === 0 && (
          <p className="text-meta text-text-3 px-3 py-2">No sessions yet.</p>
        )}
        {grouped.map(([label, rows]) => (
          <div key={label} className="mb-2">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-text-3">{label}</div>
            {rows.map((session) => {
              const selected =
                session.paneId === selectedPaneId &&
                (session.sessionId
                  ? session.sessionId === selectedSessionId
                  : !selectedSessionId);
              return (
                <SessionRow
                  key={`${session.paneId}-${session.id}`}
                  session={session}
                  selected={selected}
                  onSelect={() => {
                    onSelectSession(session.paneId, session.sessionId);
                    if (session.sessionId) markSessionRead(session.paneId, session.sessionId);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
