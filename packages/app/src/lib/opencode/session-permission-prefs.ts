import type { ComposerPermissionMode } from './session-permission-mode.js';

export type SessionPermissionModeRef = {
  mode: ComposerPermissionMode;
  userPicked?: boolean;
};

const STORAGE_VERSION = 1;
const KEY_PREFIX = 'loomria:composer-permission:';

function storageKey(paneId: string, sessionId: string): string {
  return `${KEY_PREFIX}v${STORAGE_VERSION}:${paneId}:${sessionId}`;
}

function parseStored(raw: string): SessionPermissionModeRef | null {
  try {
    const parsed = JSON.parse(raw) as SessionPermissionModeRef;
    if (parsed?.mode === 'allow' || parsed?.mode === 'ask') return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function getSessionComposerPermissionMode(
  paneId: string,
  sessionId: string,
): SessionPermissionModeRef | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(paneId, sessionId));
    if (!raw) return null;
    return parseStored(raw);
  } catch {
    return null;
  }
}

export function getUserPickedSessionPermissionMode(
  paneId: string,
  sessionId: string,
): ComposerPermissionMode | null {
  const stored = getSessionComposerPermissionMode(paneId, sessionId);
  if (!stored?.userPicked) return null;
  return stored.mode;
}

export function setSessionComposerPermissionMode(
  paneId: string,
  sessionId: string,
  ref: SessionPermissionModeRef,
): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      storageKey(paneId, sessionId),
      JSON.stringify({ ...ref, userPicked: true }),
    );
  } catch {
    /* ignore */
  }
}
