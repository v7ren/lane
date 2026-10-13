import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiMode } from './useUiMode';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({ desktop: true }));
vi.mock('../lib/is-tauri', () => ({ isTauriRuntime: () => runtime.desktop }));

const loadSettings = vi.fn();
const updateSettings = vi.fn(async () => undefined);

vi.mock('../lib/settings', () => ({
  loadSettings: (...args: unknown[]) => loadSettings(...args),
  updateSettings: (...args: unknown[]) => updateSettings(...(args as [])),
}));

function mount() {
  const box: { api: ReturnType<typeof useUiMode> | null } = { api: null };
  function Probe() {
    box.api = useUiMode();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  return { box, root, render: () => act(() => root.render(<Probe />)) };
}

describe('useUiMode', () => {
  beforeEach(() => {
    localStorage.clear();
    runtime.desktop = true;
    loadSettings.mockReset();
    updateSettings.mockClear();
    loadSettings.mockResolvedValue({});
  });

  it('defaults to agent mode', async () => {
    const m = mount();
    await m.render();
    expect(m.box.api!.uiMode).toBe('agent');
    await act(async () => m.root.unmount());
  });

  it('reads the localStorage cache for the first paint', async () => {
    localStorage.setItem('loomria-ui-mode', 'ide');
    loadSettings.mockReturnValue(new Promise(() => undefined));
    const m = mount();
    await m.render();
    expect(m.box.api!.uiMode).toBe('ide');
    await act(async () => m.root.unmount());
  });

  it('hydrates from settings and refreshes the cache', async () => {
    loadSettings.mockResolvedValue({ ui_mode: 'ide' });
    const m = mount();
    await m.render();
    await act(async () => undefined);
    expect(m.box.api!.uiMode).toBe('ide');
    expect(localStorage.getItem('loomria-ui-mode')).toBe('ide');
    await act(async () => m.root.unmount());
  });

  it('does not hydrate outside the desktop runtime, keeping the cached mode', async () => {
    runtime.desktop = false;
    localStorage.setItem('loomria-ui-mode', 'ide');
    loadSettings.mockResolvedValue({ ui_mode: 'agent' });
    const m = mount();
    await m.render();
    await act(async () => undefined);
    expect(loadSettings).not.toHaveBeenCalled();
    expect(m.box.api!.uiMode).toBe('ide');
    await act(async () => m.root.unmount());
  });

  it('persists to cache and settings when changed, and toggles', async () => {
    const m = mount();
    await m.render();
    await act(async () => m.box.api!.setUiMode('ide'));
    expect(m.box.api!.uiMode).toBe('ide');
    expect(localStorage.getItem('loomria-ui-mode')).toBe('ide');
    expect(updateSettings).toHaveBeenCalledWith({ ui_mode: 'ide' });
    await act(async () => m.box.api!.toggleUiMode());
    expect(m.box.api!.uiMode).toBe('agent');
    expect(updateSettings).toHaveBeenLastCalledWith({ ui_mode: 'agent' });
    await act(async () => m.root.unmount());
  });

  it('survives a throwing localStorage', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const m = mount();
    await m.render();
    expect(m.box.api!.uiMode).toBe('agent');
    spy.mockRestore();
    await act(async () => m.root.unmount());
  });
});
