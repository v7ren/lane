import { useEffect, useState, type CSSProperties } from 'react';

/** Position the persistent TUI surface over the in-layout region for the active pane. */
export function useAgentTuiSurfaceLayout(
  paneId: string | null,
  agentTuiVisible: boolean,
  layoutEpoch: number,
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties>();

  useEffect(() => {
    if (!agentTuiVisible || !paneId) {
      setStyle(undefined);
      return;
    }

    const region = document.querySelector(`[data-agent-tui-region="${paneId}"]`);
    const host = region?.closest('[data-testid="bottom-panel-host"]');
    if (!(region instanceof HTMLElement) || !(host instanceof HTMLElement)) {
      return;
    }

    let frame = 0;
    let lastKey = '';
    const update = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        const regionRect = region.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        const left = Math.round(regionRect.left - hostRect.left);
        const top = Math.round(regionRect.top - hostRect.top);
        const width = Math.round(regionRect.width);
        const height = Math.round(regionRect.height);
        const key = `${left},${top},${width},${height}`;
        if (key === lastKey) return;
        lastKey = key;
        setStyle({
          left,
          top,
          width,
          height,
          right: 'auto',
          bottom: 'auto',
        });
      });
    };

    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(region);
    ro?.observe(host);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [agentTuiVisible, layoutEpoch, paneId]);

  return style;
}
