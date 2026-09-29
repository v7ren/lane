import { TERMINAL_FONT_SIZE } from './theme';

/** Estimate PTY cols/rows from a host element (matches xterm fit heuristics). */
export function measureTerminalGrid(host: HTMLElement): { cols: number; rows: number } | null {
  const rect = host.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : host.clientWidth;
  const height = rect.height > 0 ? rect.height : host.clientHeight;
  if (width <= 0 || height <= 0) return null;

  const charWidth = TERMINAL_FONT_SIZE * 0.601;
  const lineHeight = Math.max(TERMINAL_FONT_SIZE, TERMINAL_FONT_SIZE * 1.2);
  const cols = Math.max(2, Math.floor(width / charWidth));
  const rows = Math.max(2, Math.floor(height / lineHeight));
  return { cols, rows };
}

/** Prefer a visible terminal host; fall back to the bottom panel footprint. */
export function measureSpawnTerminalSize(): { cols: number; rows: number } | null {
  const visibleHost = document.querySelector(
    '[data-pane-surface-host="1"] .terminal-host',
  ) as HTMLElement | null;
  if (visibleHost) {
    const sized = measureTerminalGrid(visibleHost);
    if (sized) return sized;
  }

  const bottom = document.querySelector('[data-testid="bottom-panel-host"]') as HTMLElement | null;
  if (bottom) {
    const sized = measureTerminalGrid(bottom);
    if (sized) return sized;
  }

  return null;
}
