import type { AppMode } from '../hooks/useWorkspaceMode';

export const NOTIFY_SESSION_STATES = new Set(['needs_approval', 'done']);

export type SessionNotifyInput = {
  paneId: string;
  previousState: string | undefined;
  nextState: string;
  muted: boolean;
  mode: AppMode;
  focusedPaneId: string | null;
  windowFocused: boolean;
  bodyDetail?: string | null;
  /** The state change came from replayed history, not the live stream. */
  replayed?: boolean;
};

export type SessionNotifyDecision =
  | { notify: false; reason: string }
  | { notify: true; title: string; body: string; bodyDetail?: string | null };

export function decideSessionNotification(input: SessionNotifyInput): SessionNotifyDecision {
  if (input.replayed) {
    return { notify: false, reason: 'replayed' };
  }
  if (input.previousState === input.nextState) {
    return { notify: false, reason: 'unchanged_state' };
  }
  if (!NOTIFY_SESSION_STATES.has(input.nextState)) {
    return { notify: false, reason: 'not_notify_state' };
  }
  if (input.muted) {
    return { notify: false, reason: 'muted' };
  }
  if (input.mode === 'agent' && input.focusedPaneId === input.paneId && input.windowFocused) {
    return { notify: false, reason: 'focused_agent_session' };
  }

  const title = input.nextState === 'needs_approval' ? 'Approval needed' : 'Session finished';
  const body = input.bodyDetail ?? input.paneId.slice(0, 8);
  return { notify: true, title, body, bodyDetail: input.bodyDetail };
}
