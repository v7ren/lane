import { describe, expect, it, vi } from 'vitest';
import {
  layoutDeltaBelowOneCell,
  shouldNotifyPtyResize,
} from './terminal-fit';

describe('terminal-fit', () => {
  it('ignores sub-cell layout jitter', () => {
    expect(layoutDeltaBelowOneCell(800, 400, 801, 401, 9, 17)).toBe(true);
    expect(layoutDeltaBelowOneCell(800, 400, 820, 420, 9, 17)).toBe(false);
  });

  it('only notifies PTY when cols or rows change', () => {
    expect(shouldNotifyPtyResize(80, 24, 80, 24)).toBe(false);
    expect(shouldNotifyPtyResize(80, 24, 81, 24)).toBe(true);
  });

  it('ResizeObserver sub-cell callbacks do not imply PTY resize', () => {
    const onResize = vi.fn();
    let lastCols = 0;
    let lastRows = 0;
    let lastW = 0;
    let lastH = 0;
    const cellW = 9;
    const cellH = 17;

    const observeFit = (width: number, height: number) => {
      if (
        lastW > 0 &&
        layoutDeltaBelowOneCell(lastW, lastH, width, height, cellW, cellH)
      ) {
        return;
      }
      lastW = width;
      lastH = height;
      const cols = Math.floor(width / cellW);
      const rows = Math.floor(height / cellH);
      if (shouldNotifyPtyResize(lastCols, lastRows, cols, rows)) {
        lastCols = cols;
        lastRows = rows;
        onResize(cols, rows);
      }
    };

    observeFit(720, 408);
    observeFit(721, 409);
    observeFit(722, 410);
    observeFit(900, 510);

    expect(onResize).toHaveBeenCalledTimes(2);
    expect(onResize.mock.calls[0]).toEqual([80, 24]);
    expect(onResize.mock.calls[1]?.[0]).toBeGreaterThan(80);
  });
});
