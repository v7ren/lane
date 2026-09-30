import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PartFallback } from './PartFallback';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

function showDetailsButton(): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Show details',
  );
  if (!btn) throw new Error('Show details button not found');
  return btn;
}

describe('PartFallback', () => {
  it('shows title while collapsed and hides JSON until Show details', () => {
    const root = createRoot(container);
    act(() => {
      root.render(<PartFallback title="Unknown tool: mystery_tool" value={{ alpha: 1 }} />);
    });
    expect(container.querySelector('[data-testid="part-fallback"]')).not.toBeNull();
    expect(container.textContent).toContain('Unknown tool: mystery_tool');
    expect(container.textContent).not.toContain('{"');
    act(() => showDetailsButton().click());
    expect(container.textContent).toContain('"alpha"');
    expect(container.textContent).toContain('1');
    act(() => root.unmount());
  });

  it('uses Details title for generic object dumps', () => {
    const root = createRoot(container);
    act(() => {
      root.render(<PartFallback title="Details" value={{ matches: [] }} />);
    });
    expect(container.textContent).toContain('Details');
    expect(container.textContent).not.toContain('{"');
    act(() => showDetailsButton().click());
    expect(container.textContent).toContain('matches');
    act(() => root.unmount());
  });
});
