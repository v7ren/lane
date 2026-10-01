import { useSyncExternalStore } from 'react';

/**
 * A headless chat pane (Claude stream-json) has no terminal of its own. "Open in terminal" hands the
 * session to a terminal pane, the hidden companion of the chat pane: only one of the two processes
 * owns the session at a time. The companion is shown in the chat pane's TUI column, kept out of the
 * sidebar, and closed when the session goes back to the chat.
 */
type CompanionMap = Readonly<Record<string, string>>;

let companions: CompanionMap = {};
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getTuiCompanion(chatPaneId: string): string | undefined {
  return companions[chatPaneId];
}

export function setTuiCompanion(chatPaneId: string, tuiPaneId: string): void {
  companions = { ...companions, [chatPaneId]: tuiPaneId };
  emit();
}

/** Forget the companion of a chat pane and return its terminal pane id (to close it). */
export function clearTuiCompanion(chatPaneId: string): string | undefined {
  const tuiPaneId = companions[chatPaneId];
  if (tuiPaneId === undefined) return undefined;
  const { [chatPaneId]: _removed, ...rest } = companions;
  companions = rest;
  emit();
  return tuiPaneId;
}

/** Pane id whose terminal the TUI column should show for this chat pane. */
export function tuiPaneIdFor(chatPaneId: string, map: CompanionMap): string {
  return map[chatPaneId] ?? chatPaneId;
}

export function companionPaneIds(map: CompanionMap): Set<string> {
  return new Set(Object.values(map));
}

export function resetTuiCompanionsForTests(): void {
  companions = {};
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTuiCompanions(): CompanionMap {
  return useSyncExternalStore(
    subscribe,
    () => companions,
    () => companions,
  );
}
