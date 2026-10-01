/**
 * Module-level store for composer drafts, mirrored to sessionStorage.
 * Keyed by paneId; cleared on successful send.
 */

const drafts = new Map<string, string>();

/** Debounce timer for sessionStorage writes. */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

const STORAGE_KEY_PREFIX = 'loomria-draft:';

/**
 * Get the current draft for a pane, from memory or sessionStorage.
 */
export function getDraft(paneId: string): string {
  // Check memory first (most recent)
  const inMemory = drafts.get(paneId);
  if (inMemory !== undefined) return inMemory;

  // Fall back to sessionStorage
  try {
    const key = `${STORAGE_KEY_PREFIX}${paneId}`;
    const stored = globalThis.sessionStorage?.getItem(key);
    return stored ?? '';
  } catch {
    // sessionStorage may not be available or may throw quota exceeded
    return '';
  }
}

/**
 * Set the draft for a pane, updating both memory and sessionStorage (debounced).
 * @param paneId The pane identifier
 * @param text The draft text
 */
export function setDraft(paneId: string, text: string): void {
  // Always update memory immediately
  drafts.set(paneId, text);

  // Debounce sessionStorage write by 300ms
  const existingTimer = debounceTimers.get(paneId);
  if (existingTimer !== undefined) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    try {
      const key = `${STORAGE_KEY_PREFIX}${paneId}`;
      if (text) {
        globalThis.sessionStorage?.setItem(key, text);
      } else {
        globalThis.sessionStorage?.removeItem(key);
      }
    } catch {
      // sessionStorage quota exceeded or not available; silently fail
    }
    debounceTimers.delete(paneId);
  }, 300);

  debounceTimers.set(paneId, timer);
}

/**
 * Clear the draft for a pane (called after successful send).
 * Removes from both memory and sessionStorage.
 */
export function clearDraft(paneId: string): void {
  drafts.delete(paneId);

  // Cancel any pending debounce
  const timer = debounceTimers.get(paneId);
  if (timer !== undefined) {
    clearTimeout(timer);
    debounceTimers.delete(paneId);
  }

  // Clear from sessionStorage immediately
  try {
    const key = `${STORAGE_KEY_PREFIX}${paneId}`;
    globalThis.sessionStorage?.removeItem(key);
  } catch {
    // Silently fail
  }
}
