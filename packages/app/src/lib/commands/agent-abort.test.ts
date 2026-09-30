import { beforeEach, describe, expect, it, vi } from 'vitest';

const abortSession = vi.fn();
const rejectQuestion = vi.fn();
const replyPermission = vi.fn();
let state: { questions: Record<string, unknown>; permissions: Record<string, unknown> };

vi.mock('../opencode/client.js', () => ({
  opencodeClient: { abortSession: (...args: unknown[]) => abortSession(...args) },
}));

vi.mock('../opencode/store.js', () => ({
  getOpenCodeStore: () => ({
    getState: () => state,
    rejectQuestion: (...args: unknown[]) => rejectQuestion(...args),
    replyPermission: (...args: unknown[]) => replyPermission(...args),
  }),
}));

import { abortOpenCodeSession } from './agent.js';

describe('abortOpenCodeSession', () => {
  beforeEach(() => {
    abortSession.mockReset().mockResolvedValue(undefined);
    rejectQuestion.mockReset().mockResolvedValue(undefined);
    replyPermission.mockReset().mockResolvedValue(undefined);
    state = {
      questions: {
        q1: { id: 'q1', sessionID: 'sess-a' },
        q2: { id: 'q2', sessionID: 'sess-b' },
      },
      permissions: {
        p1: { id: 'p1', sessionID: 'sess-a' },
        p2: { id: 'p2', sessionID: 'sess-b' },
      },
    };
  });

  it("aborts, then rejects only that session's pending asks", async () => {
    await abortOpenCodeSession('pane-1', 'sess-a');
    expect(abortSession).toHaveBeenCalledWith('pane-1', 'sess-a');
    expect(rejectQuestion).toHaveBeenCalledTimes(1);
    expect(rejectQuestion).toHaveBeenCalledWith('q1');
    expect(replyPermission).toHaveBeenCalledTimes(1);
    expect(replyPermission).toHaveBeenCalledWith('p1', 'reject');
  });

  it('still resolves when a reject fails', async () => {
    rejectQuestion.mockRejectedValue(new Error('gone'));
    await expect(abortOpenCodeSession('pane-1', 'sess-a')).resolves.toBeUndefined();
    expect(replyPermission).toHaveBeenCalledWith('p1', 'reject');
  });
});
