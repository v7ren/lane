import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextBar, contextLevel, contextPercent } from './ContextBar';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('ContextBar', () => {
  it('thresholds: amber at 80, red at 95', () => {
    expect(contextLevel(79)).toBe('ok');
    expect(contextLevel(80)).toBe('warn');
    expect(contextLevel(94)).toBe('warn');
    expect(contextLevel(95)).toBe('critical');
    expect(contextPercent(160_000, 200_000)).toBe(80);
  });
  it('shows percent and tooltip', () => {
    act(() => root.render(<ContextBar tokens={100_000} window={200_000} />));
    const el = host.querySelector('[data-testid="context-bar"]');
    expect(el?.textContent).toBe('50%');
    expect(el?.getAttribute('title')).toBe('100,000 of 200,000 tokens');
    expect(el?.getAttribute('data-level')).toBe('ok');
  });
  it('is hidden when the window is unknown', () => {
    act(() => root.render(<ContextBar tokens={10} window={undefined} />));
    expect(host.querySelector('[data-testid="context-bar"]')).toBeNull();
  });
});
