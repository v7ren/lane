import { createRoot } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useWindowCloseGuard } from './useWindowCloseGuard';
import {
  resetAppCloseConfirmForTests,
  setCloseConfirmListener,
} from '../lib/window-close-request';

const listPanes = vi.fn();
const closeCurrentWindow = vi.fn();
const killAllPanes = vi.fn();
let closeHandler: ((event: { preventDefault: () => void }) => void | Promise<void>) | null =
  null;

vi.mock('../lib/is-tauri', () => ({ isTauriRuntime: () => true }));

vi.mock('../lib/tauri', () => ({
  tauri: {
    listPanes: (...args: unknown[]) => listPanes(...args),
    closeCurrentWindow: (...args: unknown[]) => closeCurrentWindow(...args),
    killAllPanes: (...args: unknown[]) => killAllPanes(...args),
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
    resetAppCloseConfirmForTests();
    listPanes.mockReset();
    closeCurrentWindow.mockReset();
    killAllPanes.mockReset();
    killAllPanes.mockResolvedValue(undefined);
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

  it('kills panes and destroys once on confirm without re-prompting', async () => {
    listPanes.mockResolvedValue([{ agent_type: 'opencode_native', id: 'a1' }]);
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(<GuardHost />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    setCloseConfirmListener(({ resolve }) => {
      resolve(true);
    });

    const prevent = vi.fn();
    await act(async () => {
      await closeHandler?.({ preventDefault: prevent });
    });
    expect(prevent).toHaveBeenCalledTimes(1);
    expect(killAllPanes).toHaveBeenCalledTimes(1);
    expect(closeCurrentWindow).toHaveBeenCalledTimes(1);

    const preventAgain = vi.fn();
    await act(async () => {
      await closeHandler?.({ preventDefault: preventAgain });
    });
    expect(preventAgain).not.toHaveBeenCalled();
    expect(closeCurrentWindow).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it('forces exit when confirmation times out', async () => {
    listPanes.mockResolvedValue([{ agent_type: 'opencode_native', id: 'a1' }]);
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() => {
      root.render(<GuardHost />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(closeHandler).not.toBeNull();

    setCloseConfirmListener(() => {
      /* never resolves */
    });

    const prevent = vi.fn();
    void closeHandler?.({ preventDefault: prevent });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(killAllPanes).toHaveBeenCalled();
    expect(closeCurrentWindow).toHaveBeenCalled();
    act(() => root.unmount());
  });
});
