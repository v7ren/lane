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

    const update = () => {
      const regionRect = region.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      setStyle({
        left: regionRect.left - hostRect.left,
        top: regionRect.top - hostRect.top,
        width: regionRect.width,
        height: regionRect.height,
        right: 'auto',
        bottom: 'auto',
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
