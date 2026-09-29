import type { Message, Part } from '@loomria/shared/opencode';

import type { OpenCodeStoreState } from './store.js';

export function messageCreatedAt(message: Message): number {
  const time = message.time as { created?: number } | undefined;
  return time?.created ?? 0;
}

export function messageParentId(message: Message): string | undefined {
  const parent = (message as Message & { parentID?: string }).parentID;
  return typeof parent === 'string' && parent.length > 0 ? parent : undefined;
}

/** Chronological session messages; user rows precede children that reference them via parentID. */
export function compareSessionMessages(a: Message, b: Message): number {
  const parentA = messageParentId(a);
  const parentB = messageParentId(b);
  if (parentA === b.id) return 1;
  if (parentB === a.id) return -1;

  const byCreated = messageCreatedAt(a) - messageCreatedAt(b);
  if (byCreated !== 0) return byCreated;
  return a.id.localeCompare(b.id);
}

export function sortMessageIds(state: OpenCodeStoreState, sessionId: string, ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const ma = state.messages[a];
    const mb = state.messages[b];
    if (!ma || !mb) return a.localeCompare(b);
    return compareSessionMessages(ma, mb);
  });
}

function partTimeStart(part: Part | undefined): number | undefined {
  if (!part) return undefined;
  const direct = 'time' in part ? (part.time as { start?: number } | undefined)?.start : undefined;
  if (direct != null) return direct;
  if (part.type === 'tool' && part.state && typeof part.state === 'object' && 'time' in part.state) {
    const nested = (part.state as { time?: { start?: number } }).time?.start;
    if (nested != null) return nested;
  }
  return undefined;
}

export function comparePartIds(state: OpenCodeStoreState, a: string, b: string): number {
  const orderA = state.partOrder[a];
  const orderB = state.partOrder[b];
  if (orderA != null && orderB != null && orderA !== orderB) {
    return orderA - orderB;
  }
  if (orderA != null && orderB == null) return -1;
  if (orderA == null && orderB != null) return 1;

  const timeA = partTimeStart(state.parts[a]);
  const timeB = partTimeStart(state.parts[b]);
  if (timeA != null && timeB != null && timeA !== timeB) return timeA - timeB;
  if (timeA != null && timeB == null) return -1;
  if (timeA == null && timeB != null) return 1;
  return a.localeCompare(b);
}

export function sortPartIdsForMessage(
  state: OpenCodeStoreState,
  _messageId: string,
  partIds: string[],
): string[] {
  return [...partIds].sort((a, b) => comparePartIds(state, a, b));
}
