import { DISPLAY_STATUS_ORDER, type DisplayStatus } from '../display-status';
import type { ShellSession } from '../shell-data';

export type SessionSortMode = 'attention' | 'recent';

export function filterSessions(rows: ShellSession[], query: string): ShellSession[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => {
    const hay = `${row.title} ${row.lastMessagePreview ?? ''} ${row.agentLabel}`.toLowerCase();
    return hay.includes(q);
  });
}

export function sortShellSessions(rows: ShellSession[], mode: SessionSortMode): ShellSession[] {
  return [...rows].sort((a, b) => {
    if (mode === 'attention') {
      const sa = DISPLAY_STATUS_ORDER[a.status] ?? 99;
      const sb = DISPLAY_STATUS_ORDER[b.status] ?? 99;
      if (sa !== sb) return sa - sb;
    }
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export function formatRelativeTime(ms: number, now = Date.now()): string {
  if (!ms) return '';
  const delta = Math.max(0, now - ms);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

export function statusRank(status: DisplayStatus): number {
  return DISPLAY_STATUS_ORDER[status] ?? 99;
}
