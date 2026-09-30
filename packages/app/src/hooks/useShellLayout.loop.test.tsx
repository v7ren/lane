import { createRoot } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useShellLayout } from './useShellLayout';
import { defaultBottomRatio } from '../lib/shell-layout';

vi.mock('../lib/settings', () => ({
  loadSettings: vi.fn(async () => ({})),
  updateSettings: vi.fn(async () => undefined),
}));

function ShellLayoutProbe({
  onLayout,
}: {
  onLayout: (api: ReturnType<typeof useShellLayout>) => void;
}): ReactNode {
  const api = useShellLayout();
  onLayout(api);
  return null;
}

describe('useShellLayout', () => {
  beforeEach(() => {
    localStorage.removeItem('loomria-bottom-ratio-touched');
    localStorage.removeItem('loomria-shell-layout-v2');
  });

  it('does not loop when applying the same bottom panel ratio repeatedly', () => {
    let latest: ReturnType<typeof useShellLayout> | null = null;
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(<ShellLayoutProbe onLayout={(api) => { latest = api; }} />);
    });
    const target = defaultBottomRatio({ hasEditorTabs: false });
    act(() => {
      for (let i = 0; i < 5; i++) {
        latest!.patchLayout({ bottomPanelPercent: target });
      }
    });
    expect(latest!.layout.bottomPanelPercent).toBe(target);
    act(() => root.unmount());
  });
});
