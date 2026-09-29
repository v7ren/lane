/** Pixel heights of chrome stacked above persistent terminal surfaces in the bottom panel. */
export const BOTTOM_PANEL_TAB_BAR_PX = 28;
export const TERMINAL_SHELL_BAR_PX = 28;

export function terminalSurfaceTopPx(): number {
  return BOTTOM_PANEL_TAB_BAR_PX + TERMINAL_SHELL_BAR_PX;
}

export function agentTuiSurfaceTopPx(): number {
  return BOTTOM_PANEL_TAB_BAR_PX;
}
