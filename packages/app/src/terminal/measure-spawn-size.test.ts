import { describe, expect, it } from 'vitest';

import { measureTerminalGrid } from './measure-spawn-size.js';

describe('measureTerminalGrid', () => {
  it('returns null for zero-sized hosts', () => {
    const host = document.createElement('div');
    host.style.width = '0px';
    host.style.height = '0px';
    document.body.appendChild(host);
    expect(measureTerminalGrid(host)).toBeNull();
    host.remove();
  });

  it('returns positive cols and rows for visible hosts', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.getBoundingClientRect = () =>
      ({
        width: 640,
        height: 360,
        top: 0,
        left: 0,
        right: 640,
        bottom: 360,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const grid = measureTerminalGrid(host);
    expect(grid).not.toBeNull();
    expect(grid!.cols).toBeGreaterThan(10);
    expect(grid!.rows).toBeGreaterThan(5);
    host.remove();
  });
});
