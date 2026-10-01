import { ArrowDownUp, ChevronRight, Plus, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useSessionList, useSessionListFilter } from '../../lib/shell-data';
import type { SessionSortMode } from '../../lib/sessions/filter-sort';
import { useShellSelection } from '../../lib/shell-selection-context';
import { markSessionRead } from '../../lib/sessions/session-read-state';
import { useSessionActions } from '../../lib/sessions/session-actions-context';
import { groupSessionsByWorkspace } from '../../lib/sessions/workspace-groups';
import { SessionRow } from './SessionRow';

const SORT_LABEL: Record<SessionSortMode, string> = {
  attention: 'Needs attention',
  recent: 'Recent',
};

export function SessionsSidebar({
  connecting,
  onSelectSession,
  onResumeClaudeSession,
}: {
  connecting?: boolean;
  onSelectSession: (paneId: string, sessionId?: string) => void;
  onResumeClaudeSession?: (claudeSessionId: string) => void;
}) {
  const { query, setQuery, sortMode, setSortMode } = useSessionListFilter();
  const sessions = useSessionList({ query, sortMode, includePast: true });
  const { selectedPaneId, selectedSessionId } = useShellSelection();
  const actions = useSessionActions();
  const [sortOpen, setSortOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const sortRef = useRef<HTMLDivElement>(null);

  const grouped = useMemo(() => groupSessionsByWorkspace(sessions), [sessions]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      className="flex flex-col min-h-0 h-full bg-surface overflow-x-hidden"
      data-testid="sidebar-sessions"
    >
      <div className="px-3 h-7 flex items-center justify-between border-b border-border-subtle shrink-0">
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
      <div className="px-2 py-2 border-b border-border-subtle flex items-center gap-1.5 shrink-0 min-w-0">
        <Search size={14} className="text-text-3 shrink-0" strokeWidth={1.5} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sessions…"
          className="flex-1 min-w-0 w-0 bg-transparent text-meta outline-none placeholder:text-text-3"
          data-testid="session-search"
        />
        <div className="relative shrink-0" ref={sortRef}>
          <button
            type="button"
            aria-label={`Sort: ${SORT_LABEL[sortMode]}`}
            title={`Sort: ${SORT_LABEL[sortMode]}`}
            className="p-1 rounded-md text-text-3 hover:text-text hover:bg-hover"
            data-testid="session-sort-toggle"
            onClick={() => setSortOpen((v) => !v)}
          >
            <ArrowDownUp size={14} strokeWidth={1.5} />
          </button>
          {sortOpen && (
            <>
              <div className="fixed inset-0 z-[70]" onMouseDown={() => setSortOpen(false)} />
              <div className="absolute right-0 top-full z-[71] mt-1 min-w-[140px] rounded-md border border-border bg-elevated shadow-lg py-1 text-meta">
                {(['attention', 'recent'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`w-full text-left px-3 py-1.5 hover:bg-hover ${sortMode === mode ? 'text-text' : 'text-text-2'}`}
                    onClick={() => {
                      setSortMode(mode);
                      setSortOpen(false);
                    }}
                  >
                    {SORT_LABEL[mode]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1 min-w-0">
        {connecting && sessions.length === 0 && (
          <p className="text-meta text-text-3 px-3 py-2">Connecting to session feed…</p>
        )}
        {!connecting && sessions.length === 0 && (
          <p className="text-meta text-text-3 px-3 py-2">No sessions yet.</p>
        )}
        {grouped.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          return (
            <div key={group.key} className="mb-1 min-w-0">
              <button
                type="button"
                title={group.tooltip}
                onClick={() => toggleGroup(group.key)}
                className="w-full flex items-center gap-1 px-3 py-1 text-[11px] uppercase tracking-wide text-text-3 hover:text-text-2 min-w-0"
                data-testid="session-group-header"
              >
                <ChevronRight
                  size={12}
                  className={`shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                />
                <span className="truncate">{group.label}</span>
              </button>
              {!isCollapsed &&
                group.rows.map((session) => {
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
                        if (session.claudeResumeId) {
                          onResumeClaudeSession?.(session.claudeResumeId);
                          return;
                        }
                        onSelectSession(session.paneId, session.sessionId);
                        if (session.sessionId) markSessionRead(session.paneId, session.sessionId);
                      }}
                    />
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
