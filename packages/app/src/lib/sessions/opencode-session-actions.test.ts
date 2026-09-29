import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { opencodeSessionActions, forkAt } from './opencode-session-actions';
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
});
