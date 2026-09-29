import { useEffect, useRef } from 'react';
import { selectTuiSession } from '../opencode/client.js';
import { isTauriRuntime } from '../is-tauri';
import { useShellToast } from './shell-toast';

export function useOpenCodeTuiSync(
  paneId: string | null,
  sessionId: string | null | undefined,
  enabled: boolean,
): void {
  const { pushToast } = useShellToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef<string>('');

  useEffect(() => {
    if (!enabled || !isTauriRuntime() || !paneId || !sessionId) return;
    const sig = `${paneId}:${sessionId}`;
    if (sig === last.current) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      last.current = sig;
      void selectTuiSession(paneId, sessionId).catch((err) => {
        pushToast(`TUI sync failed: ${String(err)}`);
      });
    }, 250);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, paneId, pushToast, sessionId]);
}
