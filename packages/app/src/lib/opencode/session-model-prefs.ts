export type SessionModelRef = { providerID: string; modelID: string };

function storageKey(paneId: string, sessionId: string): string {
  return `loomria:composer-model:${paneId}:${sessionId}`;
}

export function getSessionComposerModel(
  paneId: string,
  sessionId: string,
): SessionModelRef | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(paneId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionModelRef;
    if (parsed?.providerID && parsed?.modelID) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function setSessionComposerModel(
  paneId: string,
  sessionId: string,
  model: SessionModelRef,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(paneId, sessionId), JSON.stringify(model));
  } catch {
    /* ignore */
  }
}
