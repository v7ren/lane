import { useCallback, useEffect, useState } from 'react';
import type { OpenCodePermission, SessionMessagesView } from '../lib/opencode-chat';
import { tauri } from '../lib/tauri';

export function useOpenCodeChat(
  paneId: string | null,
  open: boolean,
  sessionState?: string | null,
) {
  const [view, setView] = useState<SessionMessagesView | null>(null);
  const [permissions, setPermissions] = useState<OpenCodePermission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!paneId || !open) return;
    setRefreshing(true);
    try {
      const [messages, perms] = await Promise.all([
        tauri.readOpenCodeMessages({ pane_id: paneId, limit: 50 }),
        tauri.listOpenCodePermissions(paneId).catch(() => [] as OpenCodePermission[]),
      ]);
      setView(messages);
      setPermissions(perms);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setRefreshing(false);
    }
  }, [open, paneId]);

  useEffect(() => {
    if (!open || !paneId) {
      setView(null);
      setPermissions([]);
      setError(null);
      return;
    }
    void refresh();
  }, [open, paneId, refresh]);

  useEffect(() => {
    if (!open || !paneId) return;
    const active =
      sessionState === 'working' ||
      sessionState === 'needs_approval' ||
      Boolean(view?.pending_question);
    const ms = active ? 800 : 1500;
    const id = window.setInterval(() => void refresh(), ms);
    return () => window.clearInterval(id);
  }, [open, paneId, refresh, sessionState, view?.pending_question]);

  return { view, permissions, error, refreshing, refresh };
}
