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

export function displayStatusDotClass(status: DisplayStatus): string {
  switch (status) {
    case 'needs_approval':
      return 'bg-lr-warn';
    case 'error':
      return 'bg-lr-err';
    case 'rate_limited':
      return 'bg-lr-info';
    case 'working':
      return 'bg-lr-accent';
    case 'done':
      return 'bg-lr-ok';
    case 'idle':
      return 'bg-lr-muted';
    case 'connecting':
      return 'bg-lr-muted/70';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function displayStatusTextClass(status: DisplayStatus): string {
  switch (status) {
    case 'needs_approval':
      return 'text-lr-warn font-semibold';
    case 'error':
      return 'text-lr-err font-medium';
    case 'rate_limited':
      return 'text-lr-info font-medium';
    case 'working':
      return 'text-lr-accent';
    case 'done':
      return 'text-lr-ok';
    case 'idle':
      return 'text-lr-muted';
    case 'connecting':
      return 'text-lr-muted';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function displayStatusRailAccentClass(status: DisplayStatus): string {
  switch (status) {
    case 'needs_approval':
      return 'border-l-lr-warn';
    case 'error':
      return 'border-l-lr-err';
    case 'rate_limited':
      return 'border-l-lr-info';
    case 'working':
      return 'border-l-lr-accent';
    case 'done':
      return 'border-l-lr-ok';
    case 'idle':
      return 'border-l-lr-muted/60';
    case 'connecting':
      return 'border-l-lr-muted/40';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function displayStatusRailSurfaceClass(status: DisplayStatus, selected: boolean): string {
  if (status === 'needs_approval') {
    return selected
      ? 'border-lr-warn/55 bg-lr-warn/12 lr-rail-needs-approval'
      : 'border-lr-warn/40 bg-lr-warn/8 lr-rail-needs-approval';
  }
  if (status === 'error') {
    return selected ? 'border-lr-err/50 bg-lr-err/10' : 'border-lr-err/35 bg-lr-err/5';
  }
  if (status === 'rate_limited') {
    return selected ? 'border-lr-info/45 bg-lr-info/10' : 'border-lr-info/30 bg-lr-info/5';
  }
  if (selected) return 'border-lr-accent/50 bg-lr-accent/10';
  return 'border-lr-border/60 bg-lr-bg/40 hover:bg-lr-raised/60';
}
