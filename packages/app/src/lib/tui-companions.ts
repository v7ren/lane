import { useSyncExternalStore } from 'react';

/**
 * A headless chat pane (Claude stream-json) has no terminal of its own. "Show TUI" resumes the
 * same session in a second, terminal pane; that pane is a hidden companion of the chat pane:
 * it is shown in the chat pane's TUI column, kept out of the sidebar, and closed with it.
 */
type CompanionMap = Readonly<Record<string, string>>;

let companions: CompanionMap = {};
/** Assistant turns of the chat that the terminal had loaded when it was opened or last synced. */
let syncedTurns: Readonly<Record<string, number>> = {};
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getTuiCompanion(chatPaneId: string): string | undefined {
  return companions[chatPaneId];
}

export function setTuiCompanion(chatPaneId: string, tuiPaneId: string, loadedAssistantTurns = 0): void {
  companions = { ...companions, [chatPaneId]: tuiPaneId };
  syncedTurns = { ...syncedTurns, [chatPaneId]: loadedAssistantTurns };
  emit();
}

export function getTuiSyncedTurns(chatPaneId: string): number {
  return syncedTurns[chatPaneId] ?? 0;
}

export function useTuiSyncedTurns(chatPaneId: string): number {
  return useSyncExternalStore(
    subscribe,
    () => syncedTurns[chatPaneId] ?? 0,
    () => 0,
  );
}

export function countAssistantTurns(turns: ReadonlyArray<{ role: string }>): number {
  return turns.filter((turn) => turn.role === 'assistant').length;
}

/** Claude saves a session after its first reply; only then can a terminal resume the chat. */
export function canResumeClaudeSession(
  turns: ReadonlyArray<{ role: string }>,
  status: string,
): boolean {
  return countAssistantTurns(turns) > 0 && (status === 'done' || status === 'idle');
}

/** The chat has finished replies the terminal has not loaded (it is stale until resynced). */
export function tuiNeedsSync(
  turns: ReadonlyArray<{ role: string }>,
  status: string,
  loadedAssistantTurns: number,
): boolean {
  return canResumeClaudeSession(turns, status) && countAssistantTurns(turns) > loadedAssistantTurns;
}

/** Forget the companion of a chat pane and return its terminal pane id (to close it). */
export function clearTuiCompanion(chatPaneId: string): string | undefined {
  const tuiPaneId = companions[chatPaneId];
  if (tuiPaneId === undefined) return undefined;
  const { [chatPaneId]: _removed, ...rest } = companions;
  companions = rest;
  const { [chatPaneId]: _synced, ...restSynced } = syncedTurns;
  syncedTurns = restSynced;
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
  syncedTurns = {};
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
