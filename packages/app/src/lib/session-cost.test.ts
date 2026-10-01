import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_SESSION_COST, formatCost, nextSessionCost, sessionCostTotal, useSessionCost } from './session-cost';

let host: HTMLDivElement;
let root: Root;

function CostProbe({ paneId, latest }: { paneId: string; latest?: number | null }) {
  return createElement('output', { 'data-testid': paneId }, formatCost(useSessionCost(paneId, latest)) ?? 'unknown');
}

function renderCostProbe(paneId: string, latest?: number | null): void {
  act(() => root.render(createElement(CostProbe, { paneId, latest })));
}

function displayedCost(paneId: string): string | null {
  return host.querySelector(`[data-testid="${paneId}"]`)?.textContent ?? null;
}

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

describe('session cost', () => {
  it('is unknown until a value arrives', () => {
    expect(sessionCostTotal(EMPTY_SESSION_COST)).toBeNull();
    expect(formatCost(null)).toBeNull();
    expect(nextSessionCost(EMPTY_SESSION_COST, undefined)).toBe(EMPTY_SESSION_COST);
  });
  it('a rising cumulative value replaces the latest', () => {
    let s = nextSessionCost(EMPTY_SESSION_COST, 0.1035);
    s = nextSessionCost(s, 0.118);
    expect(sessionCostTotal(s)).toBeCloseTo(0.118);
  });
  it('a lower value means a restart: the previous total moves to base', () => {
    let s = nextSessionCost(EMPTY_SESSION_COST, 0.118);
    s = nextSessionCost(s, 0.05);
    expect(sessionCostTotal(s)).toBeCloseTo(0.168);
    s = nextSessionCost(s, 0.07);
    expect(sessionCostTotal(s)).toBeCloseTo(0.188);
  });
  it('formats dollars', () => {
    expect(formatCost(0.118)).toBe('$0.12');
  });

  it('keeps per-pane restart totals across unmount and does not replay the same value twice', () => {
    renderCostProbe('pane-a', 0.5);
    expect(displayedCost('pane-a')).toBe('$0.50');

    renderCostProbe('pane-a', 0.1);
    expect(displayedCost('pane-a')).toBe('$0.60');

    act(() => root.render(null));
    renderCostProbe('pane-b', 0.25);
    expect(displayedCost('pane-b')).toBe('$0.25');

    act(() => root.render(null));
    renderCostProbe('pane-a', 0.1);
    expect(displayedCost('pane-a')).toBe('$0.60');

    act(() => root.render(null));
    renderCostProbe('pane-b', 0.25);
    expect(displayedCost('pane-b')).toBe('$0.25');
  });

  it('ignores missing, non-finite, and negative cost updates', () => {
    renderCostProbe('pane-invalid', 0.5);
    renderCostProbe('pane-invalid', Number.NaN);
    expect(displayedCost('pane-invalid')).toBe('$0.50');
    renderCostProbe('pane-invalid', -1);
    expect(displayedCost('pane-invalid')).toBe('$0.50');
    renderCostProbe('pane-invalid', null);
    expect(displayedCost('pane-invalid')).toBe('$0.50');
  });
});
