/** Reserved width so xterm vertical scrollbar does not toggle layout. */
export const TERMINAL_SCROLLBAR_GUTTER_PX = 14;

export function roundLayoutPx(value: number): number {
  return Math.round(value);
}

/** True when width/height delta is smaller than one terminal cell — ignore for PTY resize. */
export function layoutDeltaBelowOneCell(
  prevWidth: number,
  prevHeight: number,
  nextWidth: number,
  nextHeight: number,
  cellWidth: number,
  cellHeight: number,
): boolean {
  const pw = roundLayoutPx(prevWidth);
  const ph = roundLayoutPx(prevHeight);
  const nw = roundLayoutPx(nextWidth);
  const nh = roundLayoutPx(nextHeight);
  if (Math.abs(nw - pw) < Math.max(1, cellWidth) && Math.abs(nh - ph) < Math.max(1, cellHeight)) {
    return true;
  }
  return false;
}

export function shouldNotifyPtyResize(
  lastCols: number,
  lastRows: number,
  cols: number,
  rows: number,
): boolean {
  return cols > 0 && rows > 0 && (cols !== lastCols || rows !== lastRows);
}
