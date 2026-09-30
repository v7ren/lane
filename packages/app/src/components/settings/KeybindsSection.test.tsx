import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeybindsSection } from './KeybindsSection';
import { ThemeSection } from './ThemeSection';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function q(id: string): HTMLElement | null {
  return container.querySelector(`[data-testid="${id}"]`);
}

function press(init: KeyboardEventInit & { key: string }) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

describe('KeybindsSection', () => {
  it('lists the five defaults', () => {
    act(() => root.render(<KeybindsSection keybinds={undefined} onChange={vi.fn()} />));
    expect(q('keybind-combo-palette')?.textContent).toBe('Ctrl+K');
    expect(q('keybind-combo-files')?.textContent).toBe('Ctrl+P');
    expect(q('keybind-combo-bottom')?.textContent).toBe('Ctrl+J');
    expect(q('keybind-combo-newAgent')?.textContent).toBe('Ctrl+Shift+L');
    expect(q('keybind-combo-terminal')?.textContent).toBe('Ctrl+`');
    expect((q('keybinds-reset-all') as HTMLButtonElement).disabled).toBe(true);
  });

  it('captures a new combo and reports overrides', () => {
    const onChange = vi.fn();
    act(() => root.render(<KeybindsSection keybinds={undefined} onChange={onChange} />));
    act(() => q('keybind-change-palette')?.click());
    expect(q('keybind-combo-palette')?.textContent).toContain('Press keys');
    press({ key: 'Control', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
    press({ key: 'O', ctrlKey: true, shiftKey: true });
    expect(onChange).toHaveBeenCalledWith({ palette: 'Ctrl+Shift+O' });
  });

  it('shows a conflict and does not save a duplicate', () => {
    const onChange = vi.fn();
    act(() => root.render(<KeybindsSection keybinds={undefined} onChange={onChange} />));
    act(() => q('keybind-change-palette')?.click());
    press({ key: 'p', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
    const err = q('keybind-error-palette')?.textContent ?? '';
    expect(err).toContain('CONFLICT');
    expect(err).toContain('Go to file');
  });

  it('rejects invalid combos with a reason', () => {
    const onChange = vi.fn();
    act(() => root.render(<KeybindsSection keybinds={undefined} onChange={onChange} />));
    act(() => q('keybind-change-files')?.click());
    press({ key: 'c', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(q('keybind-error-files')?.textContent).toContain('reserved');
  });

  it('Escape cancels capture without saving', () => {
    const onChange = vi.fn();
    act(() => root.render(<KeybindsSection keybinds={undefined} onChange={onChange} />));
    act(() => q('keybind-change-bottom')?.click());
    press({ key: 'Escape' });
    expect(onChange).not.toHaveBeenCalled();
    expect(q('keybind-combo-bottom')?.textContent).toBe('Ctrl+J');
  });

  it('resets one action and all actions', () => {
    const onChange = vi.fn();
    const keybinds = { palette: 'Ctrl+Shift+O', files: 'Ctrl+Shift+F' };
    act(() => root.render(<KeybindsSection keybinds={keybinds} onChange={onChange} />));
    expect(q('keybind-combo-palette')?.textContent).toBe('Ctrl+Shift+O');
    act(() => q('keybind-reset-palette')?.click());
    expect(onChange).toHaveBeenLastCalledWith({ files: 'Ctrl+Shift+F' });
    act(() => q('keybinds-reset-all')?.click());
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe('ThemeSection', () => {
  it('selects a swatch and resets to default', () => {
    const onChange = vi.fn();
    act(() => root.render(<ThemeSection accent="#EC4899" onChange={onChange} />));
    expect(q('accent-current')?.textContent).toContain('#EC4899');
    act(() => q('accent-swatch-22c55e')?.click());
    expect(onChange).toHaveBeenLastCalledWith('#22C55E');
    act(() => q('accent-reset')?.click());
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('picking the default swatch clears the override', () => {
    const onChange = vi.fn();
    act(() => root.render(<ThemeSection accent="#EC4899" onChange={onChange} />));
    act(() => q('accent-swatch-3b82f6')?.click());
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('disables reset at the default and marks the selected swatch', () => {
    act(() => root.render(<ThemeSection accent={undefined} onChange={vi.fn()} />));
    expect((q('accent-reset') as HTMLButtonElement).disabled).toBe(true);
    expect(q('accent-swatch-3b82f6')?.getAttribute('aria-checked')).toBe('true');
  });
});
