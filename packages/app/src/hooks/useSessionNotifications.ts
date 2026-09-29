import { useEffect, useRef } from 'react';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { SessionRailState } from './useSessionRail';
import { isSessionMuted } from '../lib/session-notify-prefs';
import type { AppMode } from './useWorkspaceMode';

const NOTIFY_STATES = new Set(['needs_approval', 'done']);

export function useSessionNotifications(
  states: Map<string, SessionRailState>,
  mode: AppMode,
  focusedPaneId: string | null,
) {
  const prevRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    let cancelled = false;
    void (async () => {
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === 'granted';
      }
      if (!granted || cancelled) return;

      const windowFocused = document.hasFocus();

      for (const [paneId, row] of states) {
        const prev = prevRef.current.get(paneId);
        if (prev === row.state) continue;
        prevRef.current.set(paneId, row.state);
        if (!NOTIFY_STATES.has(row.state)) continue;
        if (await isSessionMuted(paneId)) continue;
        if (mode === 'agent' && focusedPaneId === paneId && windowFocused) continue;

        const title =
          row.state === 'needs_approval' ? 'Approval needed' : 'Session finished';
        const body = row.detail ?? paneId.slice(0, 8);
        sendNotification({ title, body });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusedPaneId, mode, states]);
}
