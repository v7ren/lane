// Local notices for protocol and store panes.
// API: pushLocalNotice(paneId, {level, text}), useLocalNotices(paneId).
// In-memory only; survives remounts within the session.

import { useSyncExternalStore } from 'react';

export interface LocalNotice {
  readonly id: string;
  readonly level: 'info' | 'warning' | 'error';
  readonly text: string;
  readonly afterTurnId?: string;
}

// Each pane snapshot is replaced on updates and reused until that pane changes.
const EMPTY_NOTICES: readonly LocalNotice[] = Object.freeze([]);
let noticesByPane = new Map<string, readonly LocalNotice[]>();
let lastTurnIdByPane = new Map<string, string>();
const subscribers = new Set<() => void>();

/** Keep the current transcript anchor so notices without an explicit anchor stay in place. */
export function setLocalNoticeAnchor(paneId: string, turnId: string | undefined): void {
  const nextLastTurnIdByPane = new Map(lastTurnIdByPane);
  if (turnId) nextLastTurnIdByPane.set(paneId, turnId);
  else nextLastTurnIdByPane.delete(paneId);
  lastTurnIdByPane = nextLastTurnIdByPane;
}

export function pushLocalNotice(
  paneId: string,
  notice: Omit<LocalNotice, 'id'>
): string {
  const id = `local-notice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const newNotice: LocalNotice = Object.freeze({
    id,
    level: notice.level,
    text: notice.text,
    afterTurnId: notice.afterTurnId ?? lastTurnIdByPane.get(paneId),
  });
  const nextNoticesByPane = new Map(noticesByPane);
  nextNoticesByPane.set(
    paneId,
    Object.freeze([...(noticesByPane.get(paneId) ?? EMPTY_NOTICES), newNotice]),
  );
  noticesByPane = nextNoticesByPane;
  subscribers.forEach((sub) => sub());
  return id;
}

export function clearLocalNotice(paneId: string, id: string): void {
  const paneNotices = noticesByPane.get(paneId);
  if (!paneNotices?.some((notice) => notice.id === id)) return;

  const remaining = paneNotices.filter((notice) => notice.id !== id);
  const nextNoticesByPane = new Map(noticesByPane);
  if (remaining.length === 0) nextNoticesByPane.delete(paneId);
  else nextNoticesByPane.set(paneId, Object.freeze(remaining));
  noticesByPane = nextNoticesByPane;
  subscribers.forEach((sub) => sub());
}

function getNotices(paneId: string): readonly LocalNotice[] {
  return noticesByPane.get(paneId) ?? EMPTY_NOTICES;
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useLocalNotices(paneId: string): readonly LocalNotice[] {
  return useSyncExternalStore(subscribe, () => getNotices(paneId), () => getNotices(paneId));
}
