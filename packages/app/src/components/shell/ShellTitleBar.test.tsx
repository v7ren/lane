import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellTitleBar } from './ShellTitleBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;

describe('ShellTitleBar ui-mode switch', () => {
  it('renders nothing for the switch when props are absent', () => {
    act(() => root.render(<ShellTitleBar onNewPane={vi.fn()} />));
    expect(q('ui-mode-switch')).toBeNull();
  });

  it('marks the active mode with aria-pressed and reports changes', () => {
    const onUiModeChange = vi.fn();
    act(() =>
      root.render(<ShellTitleBar onNewPane={vi.fn()} uiMode="agent" onUiModeChange={onUiModeChange} />),
    );
    expect(q('ui-mode-switch')).not.toBeNull();
    expect(q('ui-mode-agent')!.getAttribute('aria-pressed')).toBe('true');
    expect(q('ui-mode-ide')!.getAttribute('aria-pressed')).toBe('false');
    act(() => q('ui-mode-agent')!.click());
    expect(onUiModeChange).not.toHaveBeenCalled();
    act(() => q('ui-mode-ide')!.click());
    expect(onUiModeChange).toHaveBeenCalledWith('ide');
  });
});
