import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMessages = vi.fn();
const listSessions = vi.fn();
const listQuestions = vi.fn();
const listPermissions = vi.fn();
const getSessionStatus = vi.fn();

vi.mock('./client.js', () => ({
  getServerInfo: vi.fn().mockResolvedValue({
    healthy: true,
    directory: '/proj',
    url_hidden: true,
  }),
  openCodeRequest: vi.fn(),
  opencodeClient: {
    listSessions: (...args: unknown[]) => listSessions(...args),
    listMessages: (...args: unknown[]) => listMessages(...args),
    listQuestions: (...args: unknown[]) => listQuestions(...args),
    listPermissions: (...args: unknown[]) => listPermissions(...args),
    getSessionStatus: (...args: unknown[]) => getSessionStatus(...args),
  },
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { getOpenCodeStore } from './store.js';
import { selectMessages } from './selectors.js';

describe('ensureSessionMessages', () => {
  beforeEach(() => {
    listMessages.mockReset();
    listSessions.mockReset();
    listQuestions.mockReset();
    listPermissions.mockReset();
    getSessionStatus.mockReset();
    listSessions.mockResolvedValue([]);
    listQuestions.mockResolvedValue([]);
    listPermissions.mockResolvedValue([]);
    getSessionStatus.mockResolvedValue({});
  });

  it('records lastRequestError and allows retry when listMessages fails', async () => {
    const paneId = `pane-ensure-${Date.now()}`;
    listMessages.mockRejectedValueOnce(new Error('list failed')).mockResolvedValueOnce([
      {
        id: 'msg_1',
        sessionID: 'sess_1',
        role: 'user',
        time: { created: Date.now() },
      },
    ]);

    const store = getOpenCodeStore(paneId);
    await store.ensureSessionMessages('sess_1');
    expect(store.getState().lastRequestError).toContain('list failed');
    expect(selectMessages(store.getState(), 'sess_1')).toHaveLength(0);

    await store.ensureSessionMessages('sess_1', { force: true });
    expect(store.getState().lastRequestError).toBeNull();
    expect(selectMessages(store.getState(), 'sess_1')).toHaveLength(1);
  });
});
