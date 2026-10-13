import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauriRuntime } from '../lib/is-tauri';
import { loadSettings, updateSettings } from '../lib/settings';

export type UiMode = 'agent' | 'ide';

export const UI_MODE_CACHE_KEY = 'loomria-ui-mode';

function isUiMode(value: unknown): value is UiMode {
  return value === 'agent' || value === 'ide';
}

function readCachedUiMode(): UiMode {
  try {
    const raw = localStorage.getItem(UI_MODE_CACHE_KEY);
    if (isUiMode(raw)) return raw;
  } catch {
    /* storage unavailable */
  }
  return 'agent';
}

function writeCachedUiMode(mode: UiMode): void {
  try {
    localStorage.setItem(UI_MODE_CACHE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Agent-first vs IDE shell layout. The first paint comes from a localStorage cache; the
 * persisted `ui_mode` setting is the source of truth and hydrates afterwards.
 */
export function useUiMode() {
  const [uiMode, setUiModeState] = useState<UiMode>(readCachedUiMode);
  /** Set once the user (or an auto-switch) changes mode, so a slow hydrate cannot overwrite it. */
  const changedRef = useRef(false);
  const modeRef = useRef(uiMode);
  modeRef.current = uiMode;

  useEffect(() => {
    // Outside the desktop runtime the settings store is unavailable and loadSettings() falls
    // back to defaults, which would clobber the cached mode (browser preview, demo, tests).
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void loadSettings()
      .then((s) => {
        if (cancelled || changedRef.current) return;
        const stored = s?.ui_mode;
        if (isUiMode(stored)) {
          setUiModeState(stored);
          writeCachedUiMode(stored);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setUiMode = useCallback((next: UiMode) => {
    changedRef.current = true;
    modeRef.current = next;
    setUiModeState(next);
    writeCachedUiMode(next);
    void Promise.resolve(updateSettings({ ui_mode: next })).catch(() => undefined);
  }, []);

  const toggleUiMode = useCallback(() => {
    setUiMode(modeRef.current === 'agent' ? 'ide' : 'agent');
  }, [setUiMode]);

  return { uiMode, setUiMode, toggleUiMode };
}
