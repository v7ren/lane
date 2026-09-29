/** Unified display status for rail, pane chrome, and agent view. */
export type DisplayStatus =
  | 'needs_approval'
  | 'error'
  | 'rate_limited'
  | 'working'
  | 'done'
  | 'idle'
  | 'connecting';

export const DISPLAY_STATUS_ORDER: Record<DisplayStatus, number> = {
  needs_approval: 0,
  error: 1,
  rate_limited: 2,
  working: 3,
  done: 4,
  idle: 5,
  connecting: 6,
};

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  needs_approval: 'Needs approval',
  error: 'Error',
  rate_limited: 'Rate limited',
  working: 'Working',
  done: 'Done',
  idle: 'Idle',
  connecting: 'Connecting',
};

export function mergePaneAndSessionStatus(
  paneStatus?: string | null,
  sessionState?: string | null,
): DisplayStatus {
  if (sessionState === 'needs_approval' || paneStatus === 'waiting_input') {
    return 'needs_approval';
  }
  if (sessionState === 'error' || paneStatus === 'error') return 'error';
  if (sessionState === 'rate_limited') return 'rate_limited';
  if (sessionState === 'working' || paneStatus === 'running') return 'working';
  if (sessionState === 'done') return 'done';
  if (sessionState === 'idle' || paneStatus === 'idle') return 'idle';
  if (!paneStatus && !sessionState) return 'connecting';
  return 'idle';
}

export function displayStatusCssVar(status: DisplayStatus): string {
  switch (status) {
    case 'needs_approval':
      return 'var(--lr-status-warn)';
    case 'error':
      return 'var(--lr-status-err)';
    case 'rate_limited':
      return 'var(--lr-status-info)';
    case 'working':
      return 'var(--lr-status-accent)';
    case 'done':
      return 'var(--lr-status-ok)';
    case 'idle':
      return 'var(--lr-status-muted)';
    case 'connecting':
      return 'var(--lr-status-muted)';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
