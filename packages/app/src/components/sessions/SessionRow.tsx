import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  DISPLAY_STATUS_LABEL,
  displayStatusRailAccentClass,
  displayStatusRailSurfaceClass,
  displayStatusTextClass,
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

  const depthPad = (session.depth ?? 0) * 12;

  return (
    <div
      className={`relative mx-1 max-w-[calc(100%-0.5rem)] rounded-sm border-l-2 ${displayStatusRailAccentClass(session.status)} ${displayStatusRailSurfaceClass(session.status, selected)}`}
      style={{ marginLeft: `${4 + depthPad}px` }}
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
          className="w-full px-2 py-1 text-meta bg-transparent outline-none"
        />
      ) : (
        <div className="flex items-start gap-0.5">
          <button
            type="button"
            onClick={onSelect}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuOpen(true);
            }}
            className="flex-1 text-left px-2 py-1 flex flex-col gap-0.5 min-w-0"
          >
            <div className="flex items-center gap-2 min-w-0">
              <DisplayStatusDot status={session.status} pulse={session.status === 'needs_approval'} />
              <span className="text-meta font-medium text-text truncate flex-1">{session.title}</span>
              {session.unread && (
                <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="Unread" />
              )}
              <span className={`text-[10px] shrink-0 ${displayStatusTextClass(session.status)}`}>
                {DISPLAY_STATUS_LABEL[session.status]}
              </span>
              <span className="text-[10px] text-text-3 shrink-0">
                {formatRelativeTime(session.updatedAt)}
              </span>
            </div>
            {session.lastMessagePreview && (
              <p className="text-[10px] text-text-3 truncate pl-5">{session.lastMessagePreview}</p>
            )}
            {session.workspaceLabel && session.depth === 0 && (
              <p className="text-[10px] text-text-3 truncate pl-5">{session.workspaceLabel}</p>
            )}
          </button>
          <button
            type="button"
            aria-label="Session menu"
            className="p-1 m-1 rounded hover:bg-hover text-text-3 shrink-0"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreHorizontal size={14} strokeWidth={1.5} />
          </button>
        </div>
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
