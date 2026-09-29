import { useEffect, useRef } from 'react';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { SessionRailState } from './useSessionRail';
import { isSessionMuted } from '../lib/session-notify-prefs';
import type { AppMode } from './useWorkspaceMode';
import { decideSessionNotification } from '../lib/session-notify-decision';
import { isTauriRuntime } from '../lib/is-tauri';

export function useSessionNotifications(
  states: Map<string, SessionRailState>,
  mode: AppMode,
  focusedPaneId: string | null,
) {
  const prevRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!isTauriRuntime()) return;
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
        const previousState = prevRef.current.get(paneId);
        if (previousState === row.state) continue;
        prevRef.current.set(paneId, row.state);

        const muted = await isSessionMuted(paneId);
        const decision = decideSessionNotification({
          paneId,
          previousState,
          nextState: row.state,
          muted,
          mode,
          focusedPaneId,
          windowFocused,
          bodyDetail: row.detail ?? null,
        });

        if (!decision.notify) continue;
        sendNotification({ title: decision.title, body: decision.body });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusedPaneId, mode, states]);
}
