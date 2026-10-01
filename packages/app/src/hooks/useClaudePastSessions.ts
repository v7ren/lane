import { useEffect, useState } from 'react';
import { isTauriRuntime } from '../lib/is-tauri';
import { tauri, type ClaudePastSession } from '../lib/tauri';

/**
 * Past Claude chats of the project (from Claude's own session files). `openPaneCount` is a
 * refetch key: opening or closing a chat moves a session in or out of the "past" list.
 */
export function useClaudePastSessions(
  enabled: boolean,
  cwd: string | null,
  openPaneCount: number,
): ClaudePastSession[] {
  const [sessions, setSessions] = useState<ClaudePastSession[]>([]);

  useEffect(() => {
    if (!enabled || !cwd || !isTauriRuntime()) {
      setSessions([]);
      return;
    }
    let cancelled = false;
    void tauri.claudeListSessions(cwd).then((list) => {
      if (!cancelled) setSessions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, cwd, openPaneCount]);

  return sessions;
}
