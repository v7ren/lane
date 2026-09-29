import { useSelectedSession } from '../../lib/shell-data';
import { useSessionActions } from '../../lib/sessions/session-actions-context';

export function RevertBanner() {
  const session = useSelectedSession();
  const actions = useSessionActions();

  if (!session?.reverted || !session.sessionId) return null;

  return (
    <div
      className="mx-2 mt-2 rounded-sm border border-lr-warn/40 bg-lr-warn/10 px-2 py-1.5 flex items-center justify-between gap-2"
      data-testid="revert-banner"
    >
      <span className="text-meta text-text-2">Session has reverted messages</span>
      <button
        type="button"
        className="text-meta text-accent hover:underline"
        onClick={() => void actions.unrevertSession(session.paneId, session.sessionId!)}
      >
        Redo
      </button>
    </div>
  );
}
