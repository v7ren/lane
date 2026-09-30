import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import {
  opencodeSessionActions,
  forkAt,
  forkAtLatestAssistant,
  NoAssistantMessageError,
} from './opencode-session-actions';
import { setOpenCodeTransport } from './opencode-transport';

describe('opencodeSessionActions', () => {
  beforeEach(() => {
    setOpenCodeTransport(null);
    vi.mocked(invoke).mockReset();
  });

  it('uses injected transport when set', async () => {
    const transport = vi.fn().mockResolvedValue({ id: 'via-http' });
    setOpenCodeTransport(transport);
    await opencodeSessionActions.listSessions('pane-1');
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/session', pane_id: 'pane-1' }),
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it('POST /session create', async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 's1' });
    await opencodeSessionActions.createSession('pane-1', { title: 'Hi', agent: 'build' });
    expect(invoke).toHaveBeenCalledWith('opencode_request', {
      args: {
        pane_id: 'pane-1',
        method: 'POST',
        path: '/session',
        body: { title: 'Hi', agent: 'build' },
      },
    });
  });

  it('POST fork with messageID', async () => {
    await opencodeSessionActions.forkSession('pane-1', 's1', { messageID: 'm1' });
    expect(invoke).toHaveBeenCalledWith('opencode_request', {
      args: {
        pane_id: 'pane-1',
        method: 'POST',
        path: '/session/s1/fork',
        body: { messageID: 'm1' },
      },
    });
  });

  it('POST revert', async () => {
    await opencodeSessionActions.revertSession('pane-1', 's1', { messageID: 'm9' });
    expect(invoke).toHaveBeenCalledWith('opencode_request', {
      args: {
        pane_id: 'pane-1',
        method: 'POST',
        path: '/session/s1/revert',
        body: { messageID: 'm9' },
      },
    });
  });

  it('forkAt helper', async () => {
    await forkAt('pane-1', 's1', 'm2');
    expect(invoke).toHaveBeenCalledWith('opencode_request', {
      args: expect.objectContaining({ path: '/session/s1/fork', body: { messageID: 'm2' } }),
    });
  });

  it('forkAtLatestAssistant forks at the last assistant message', async () => {
    const transport = vi.fn(async (args: { method: string; path: string }) =>
      args.method === 'GET'
        ? [
            { id: 'u1', role: 'user' },
            { id: 'a1', role: 'assistant' },
            { id: 'u2', role: 'user' },
            { id: 'a2', role: 'assistant' },
            { id: 'u3', role: 'user' },
          ]
        : { id: 'forked' },
    );
    setOpenCodeTransport(transport);
    const forked = await forkAtLatestAssistant('pane-1', 's1');
    expect(forked).toEqual({ id: 'forked' });
    expect(transport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/session/s1/fork',
        body: { messageID: 'a2' },
      }),
    );
  });

  it('forkAtLatestAssistant rejects with a friendly error when no assistant message', async () => {
    const transport = vi.fn(async () => [{ id: 'u1', role: 'user' }]);
    setOpenCodeTransport(transport);
    await expect(forkAtLatestAssistant('pane-1', 's1')).rejects.toBeInstanceOf(
      NoAssistantMessageError,
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
