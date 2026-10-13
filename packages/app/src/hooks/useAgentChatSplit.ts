import { useCallback, useEffect, useState } from 'react';

const DEFAULT_CHAT_PERCENT = 50;
const STORAGE_KEY = 'loomria-agent-chat-percent';
const MIN_CHAT = 38;
const MAX_CHAT = 78;
/** Matches the TUI column's `min-w` in AppShell; the chat may not squeeze it below this. */
const MIN_TUI_PX = 280;

function readSavedPercent(): number {
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= MIN_CHAT && saved <= MAX_CHAT) return saved;
  } catch {
    // Storage can be unavailable; the default split is fine.
  }
  return DEFAULT_CHAT_PERCENT;
}

function savePercent(percent: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Math.round(percent)));
  } catch {
    // Not persisting the split is harmless.
  }
}

export function useAgentChatSplit(active: boolean) {
  const [chatPercent, setChatPercent] = useState(readSavedPercent);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const row = document.querySelector('[data-agent-split-row]');
      if (!row) return;
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0) return;
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      // Keep the TUI column at its minimum width when the row is narrow (the MIN_CHAT floor wins).
      const maxForTui = ((rect.width - MIN_TUI_PX) / rect.width) * 100;
      const max = Math.max(MIN_CHAT, Math.min(MAX_CHAT, maxForTui));
      setChatPercent(Math.min(max, Math.max(MIN_CHAT, pct)));
    };
    const onUp = () => {
      setDragging(false);
      setChatPercent((current) => {
        savePercent(current);
        return current;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const startDrag = useCallback(() => setDragging(true), []);

  return { chatPercent, startDrag, dragging };
}
