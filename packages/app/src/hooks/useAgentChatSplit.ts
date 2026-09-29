import { useCallback, useEffect, useState } from 'react';

const DEFAULT_CHAT_PERCENT = 60;
const MIN_CHAT = 38;
const MAX_CHAT = 78;

export function useAgentChatSplit(active: boolean) {
  const [chatPercent, setChatPercent] = useState(DEFAULT_CHAT_PERCENT);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const row = document.querySelector('[data-agent-split-row]');
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setChatPercent(Math.min(MAX_CHAT, Math.max(MIN_CHAT, pct)));
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const startDrag = useCallback(() => setDragging(true), []);

  useEffect(() => {
    if (!active) setChatPercent(DEFAULT_CHAT_PERCENT);
  }, [active]);

  return { chatPercent, startDrag, dragging };
}
