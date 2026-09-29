import { useEffect } from 'react';
import { useSessionActions } from '../../lib/sessions/session-actions-context';
import type { ShellSession } from '../../lib/shell-data';

export function SessionContextMenu({
  session,
  open,
  onClose,
  onStartRename,
}: {
  session: ShellSession;
  open: boolean;
  onClose: () => void;
  onStartRename: () => void;
}) {
  const actions = useSessionActions();

  if (!open) return null;

  const confirmDelete = () => {
    if (!session.sessionId) return;
    if (window.confirm(`Delete session "${session.title}"? This cannot be undone.`)) {
      void actions.deleteSession(session.paneId, session.sessionId);
    }
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[80]" onMouseDown={onClose} />
      <div
        className="absolute right-1 top-full z-[81] min-w-[200px] rounded-md border border-border bg-elevated shadow-xl py-1 text-body"
        data-testid="session-context-menu"
        onMouseDown={(e) => e.stopPropagation()}
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
        {!session.sessionId && (
          <MenuItem label="Rename pane" onClick={onStartRename} />
        )}
      </div>
    </>
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
      className={`w-full text-left px-3 py-1.5 hover:bg-hover ${danger ? 'text-lr-err' : 'text-text'}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
