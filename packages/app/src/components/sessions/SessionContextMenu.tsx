import { useSessionActions } from '../../lib/sessions/session-actions-context';
import type { ShellSession } from '../../lib/shell-data';
import { AnchoredPopover } from '../shell/AnchoredPopover';
import type { RefObject } from 'react';

export function SessionContextMenu({
  session,
  open,
  anchorRef,
  onClose,
  onStartRename,
}: {
  session: ShellSession;
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onStartRename: () => void;
}) {
  const actions = useSessionActions();

  const confirmDelete = () => {
    if (!session.sessionId) return;
    if (window.confirm(`Delete session "${session.title}"? This cannot be undone.`)) {
      void actions.deleteSession(session.paneId, session.sessionId);
    }
    onClose();
  };

  return (
    <AnchoredPopover
      open={open}
      anchorRef={anchorRef}
      onClose={onClose}
      testId="session-context-menu"
      minWidth={200}
    >
      {session.sessionId && (
        <>
          <MenuItem
            label="New session"
            onClick={() => {
              void actions.createSession(session.paneId);
              onClose();
            }}
          />
          <MenuItem label="Rename…" onClick={onStartRename} />
          <MenuItem label="Fork from here…" onClick={() => void actions.forkFromHere(session)} />
          <MenuItem
            label="Summarize / compact"
            onClick={() => {
              void actions.summarizeSession(session.paneId, session.sessionId!);
              onClose();
            }}
          />
          <MenuItem
            label="Share (OpenCode link)…"
            onClick={() => {
              void actions.shareSession(session.paneId, session.sessionId!);
              onClose();
            }}
          />
          {session.shareUrl && (
            <MenuItem
              label="Unshare"
              onClick={() => {
                void actions.unshareSession(session.paneId, session.sessionId!);
                onClose();
              }}
            />
          )}
          <MenuItem
            label="Export Markdown…"
            onClick={() => {
              void actions.exportTranscript(session, 'markdown');
              onClose();
            }}
          />
          <MenuItem
            label="Export JSON…"
            onClick={() => {
              void actions.exportTranscript(session, 'json');
              onClose();
            }}
          />
          <div className="my-1 border-t border-border-subtle" />
          <MenuItem label="Delete…" danger onClick={confirmDelete} />
        </>
      )}
      {!session.sessionId && <MenuItem label="Rename pane" onClick={onStartRename} />}
    </AnchoredPopover>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`w-full text-left px-3 py-1.5 hover:bg-hover ${danger ? 'text-status-error' : 'text-text'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
