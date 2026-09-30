export type SessionModelRef = { providerID: string; modelID: string; userPicked?: boolean };

const STORAGE_VERSION = 2;
const LEGACY_KEY_PREFIX = 'loomria:composer-model:';

function storageKey(paneId: string, sessionId: string): string {
  return `loomria:composer-model:v${STORAGE_VERSION}:${paneId}:${sessionId}`;
}

function parseStored(raw: string): SessionModelRef | null {
  try {
    const parsed = JSON.parse(raw) as SessionModelRef;
    if (parsed?.providerID && parsed?.modelID) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

/** Drop unversioned keys (may contain auto-picked models from older builds). */
export function migrateLegacyComposerModelKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LEGACY_KEY_PREFIX)) continue;
      if (key.includes(`:v${STORAGE_VERSION}:`)) continue;
      toRemove.push(key);
    }
    for (const key of toRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export function getSessionComposerModel(
  paneId: string,
  sessionId: string,
): SessionModelRef | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(paneId, sessionId));
    if (!raw) return null;
    return parseStored(raw);
  } catch {
    return null;
  }
}

export function getUserPickedSessionModel(
  paneId: string,
  sessionId: string,
): SessionModelRef | null {
  const stored = getSessionComposerModel(paneId, sessionId);
  if (!stored?.userPicked) return null;
  return stored;
}

export function setSessionComposerModel(
  paneId: string,
  sessionId: string,
  model: SessionModelRef,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      storageKey(paneId, sessionId),
      JSON.stringify({ ...model, userPicked: true }),
    );
  } catch {
    /* ignore */
  }
}
