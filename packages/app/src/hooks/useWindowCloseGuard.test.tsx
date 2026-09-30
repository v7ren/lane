import { createRoot } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useWindowCloseGuard } from './useWindowCloseGuard';
import { setCloseConfirmListener } from '../lib/window-close-request';

const listPanes = vi.fn();
const closeCurrentWindow = vi.fn();
let closeHandler: ((event: { preventDefault: () => void }) => void | Promise<void>) | null =
  null;

vi.mock('../lib/is-tauri', () => ({ isTauriRuntime: () => true }));

vi.mock('../lib/tauri', () => ({
  tauri: {
    listPanes: (...args: unknown[]) => listPanes(...args),
    closeCurrentWindow: (...args: unknown[]) => closeCurrentWindow(...args),
    onCurrentWindowCloseRequested: (cb: typeof closeHandler) => {
      closeHandler = cb;
      return Promise.resolve(() => {
        closeHandler = null;
      });
    },
  },
}));

function GuardHost(): ReactNode {
  useWindowCloseGuard();
  return null;
}

describe('useWindowCloseGuard', () => {
  beforeEach(() => {
    listPanes.mockReset();
    closeCurrentWindow.mockReset();
    closeHandler = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    setCloseConfirmListener(null);
    vi.useRealTimers();
  });

  it('does not prevent close when no agent panes are running', async () => {
    listPanes.mockResolvedValue([{ agent_type: 'powershell', id: 's1' }]);
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(<GuardHost />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const prevent = vi.fn();
    await act(async () => {
      await closeHandler?.({ preventDefault: prevent });
    });
    expect(prevent).not.toHaveBeenCalled();
    expect(closeCurrentWindow).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('shows in-app confirm and closes on confirm', async () => {
    listPanes.mockResolvedValue([{ agent_type: 'opencode_native', id: 'a1' }]);
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(<GuardHost />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    let resolveConfirm: ((ok: boolean) => void) | null = null;
    setCloseConfirmListener(({ resolve }) => {
      resolveConfirm = resolve;
      resolve(true);
    });

    const prevent = vi.fn();
    await act(async () => {
      await closeHandler?.({ preventDefault: prevent });
    });
    expect(prevent).toHaveBeenCalled();
    expect(closeCurrentWindow).toHaveBeenCalled();
    act(() => root.unmount());
  });
});
