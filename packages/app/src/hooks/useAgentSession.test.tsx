import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessionCapabilities = vi.fn();

vi.mock('../lib/is-tauri', () => ({ isTauriRuntime: () => true }));
vi.mock('../lib/agent-session', async () => {
  const actual = await vi.importActual<typeof import('../lib/agent-session')>('../lib/agent-session');
  return {
    ...actual,
    sessionCapabilities: (...args: unknown[]) => sessionCapabilities(...args),
    sessionHistory: async () => [],
    subscribeAgentEvents: async () => () => {},
  };
});

import { useAgentSession } from './useAgentSession';

const CHAT_CAPS = {
  chat: true,
  send_prompt: true,
  approvals: true,
  cancel: true,
  file_changes: true,
  attach_tui: true,
};

let root: Root | null = null;
let latest: ReturnType<typeof useAgentSession> | null = null;

function Probe({ paneId, agentType }: { paneId: string; agentType: string }) {
  latest = useAgentSession(paneId, true, agentType);
  return null;
}

function mount(paneId: string, agentType: string): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<Probe paneId={paneId} agentType={agentType} />));
}

describe('useAgentSession capability retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionCapabilities.mockReset();
    latest = null;
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.useRealTimers();
  });

  it('keeps retrying a claude pane whose protocol session is not registered yet', async () => {
    sessionCapabilities
      .mockRejectedValueOnce(new Error('pane not found'))
      .mockRejectedValueOnce(new Error('pane not found'))
      .mockResolvedValue(CHAT_CAPS);

    mount('pane-1', 'claude');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(latest!.source).toBe('native_tui');

    for (let second = 0; second < 3; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(latest!.source).toBe('protocol');
    expect(latest!.capabilities.send_prompt).toBe(true);
    expect(sessionCapabilities).toHaveBeenCalledTimes(3);
  });

  it('reports starting, then failed once the retries run out, and Retry starts over', async () => {
    sessionCapabilities.mockRejectedValue(new Error('pane not found'));
    mount('pane-3', 'claude');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(latest!.connecting).toBe(true);
    expect(latest!.connectFailed).toBe(false);

    for (let second = 0; second < 25; second += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(latest!.connecting).toBe(false);
    expect(latest!.connectFailed).toBe(true);

    sessionCapabilities.mockResolvedValue(CHAT_CAPS);
    await act(async () => {
      latest!.retryConnect();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(latest!.source).toBe('protocol');
    expect(latest!.connectFailed).toBe(false);
  });

  it('does not retry agents that have no protocol chat', async () => {
    sessionCapabilities.mockRejectedValue(new Error('pane not found'));
    mount('pane-2', 'powershell');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(sessionCapabilities).toHaveBeenCalledTimes(1);
  });
});
