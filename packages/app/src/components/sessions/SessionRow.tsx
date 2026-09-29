import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  DISPLAY_STATUS_LABEL,
  displayStatusRailAccentClass,
  displayStatusRailSurfaceClass,
} from '../../lib/display-status';
import { formatRelativeTime } from '../../lib/sessions/filter-sort';
import { useSessionActions } from '../../lib/sessions/session-actions-context';
import type { ShellSession } from '../../lib/shell-data';
import { DisplayStatusDot } from '../DisplayStatusDot';
import { SessionContextMenu } from './SessionContextMenu';

export function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: ShellSession;
  selected: boolean;
  onSelect: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const actions = useSessionActions();

  useEffect(() => {
    if (renaming) inputRef.current?.focus();
  }, [renaming]);

  const depthPad = (session.depth ?? 0) * 10;
  const metaLine = [
    DISPLAY_STATUS_LABEL[session.status],
    formatRelativeTime(session.updatedAt),
    session.lastMessagePreview,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className={`group relative min-w-0 rounded-sm border-l-2 ${displayStatusRailAccentClass(session.status)} ${displayStatusRailSurfaceClass(session.status, selected)}`}
      style={{ marginLeft: `${4 + depthPad}px`, marginRight: 4 }}
      data-testid="session-row"
      data-session-id={session.sessionId ?? session.id}
    >
      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (session.sessionId) void actions.renameSession(session.paneId, session.sessionId, draft);
              setRenaming(false);
            }
            if (e.key === 'Escape') {
              setDraft(session.title);
              setRenaming(false);
            }
          }}
          onBlur={() => {
            if (session.sessionId && draft !== session.title) {
              void actions.renameSession(session.paneId, session.sessionId, draft);
            }
            setRenaming(false);
          }}
          className="w-full min-w-0 px-2 py-1.5 text-meta bg-transparent outline-none"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={onSelect}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuOpen(true);
            }}
            className="w-full min-w-0 text-left px-2 py-1.5 pr-7"
          >
            <div className="flex items-center gap-1.5 min-w-0 w-full">
              <DisplayStatusDot status={session.status} pulse={session.status === 'needs_approval'} />
              <span className="text-meta font-medium text-text truncate min-w-0 flex-1">
                {session.title}
              </span>
              {session.unread && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="Unread" />
              )}
              {session.reverted && (
                <span className="shrink-0 text-[10px] uppercase tracking-wide text-lr-warn px-1 rounded bg-lr-warn/15">
                  reverted
                </span>
              )}
            </div>
            <p className="text-[11px] leading-snug text-text-3 truncate pl-[18px] mt-0.5">{metaLine}</p>
          </button>
          <button
            type="button"
            aria-label="Session menu"
            className="absolute right-1 top-1.5 p-0.5 rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 hover:bg-hover text-text-3 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <MoreHorizontal size={14} strokeWidth={1.5} />
          </button>
        </>
      )}
      <SessionContextMenu
        session={session}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onStartRename={() => {
          setDraft(session.title);
          setRenaming(true);
          setMenuOpen(false);
        }}
      />
    </div>
  );
}
