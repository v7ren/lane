import { opencodeSessionActions } from '../../lib/sessions/opencode-session-actions';

/**
 * Shown above the agent transcript when a session has undone messages.
 *
 * @example
 * ```tsx
 * <RevertBanner paneId={paneId} sessionId={sessionId} />
 * ```
 */
export type RevertBannerProps = {
  /** OpenCode pane id (Tauri proxy scope). */
  paneId: string;
  /** OpenCode session id with an active revert state. */
  sessionId: string;
};

export function RevertBanner({ paneId, sessionId }: RevertBannerProps) {
  return (
    <div
      className="mx-3 mt-2 mb-1 rounded-sm border border-lr-warn/40 bg-lr-warn/10 px-3 py-2 flex items-center justify-between gap-3 shrink-0"
      data-testid="revert-banner"
    >
      <span className="text-meta text-text-2">Some messages were undone</span>
      <button
        type="button"
        className="text-meta text-accent hover:underline shrink-0"
        onClick={() => void opencodeSessionActions.unrevertSession(paneId, sessionId)}
      >
        Redo
      </button>
    </div>
  );
}
