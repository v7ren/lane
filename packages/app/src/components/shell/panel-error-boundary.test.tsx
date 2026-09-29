import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelErrorBoundary } from './PanelErrorBoundary';

function ReviewPanelCrash(): never {
  throw new Error('review panel crash');
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PanelErrorBoundary', () => {
  it('keeps the rest of the shell visible when review panel throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      root.render(
        <div data-testid="app-shell">
          <div data-testid="sidebar-column">Sessions</div>
          <PanelErrorBoundary region="main">
            <ReviewPanelCrash />
          </PanelErrorBoundary>
        </div>,
      );
    });
    expect(container.querySelector('[data-testid="app-shell"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="sidebar-column"]')?.textContent).toBe('Sessions');
    expect(container.querySelector('[data-testid="panel-error-main"]')).not.toBeNull();
    expect(container.textContent).toContain('Reload panel');
    spy.mockRestore();
  });
});
