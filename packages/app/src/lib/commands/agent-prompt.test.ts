import { beforeEach, describe, expect, it, vi } from 'vitest';

const patchSession = vi.fn();
const promptAsync = vi.fn();
const markSessionOptimisticBusy = vi.fn();

vi.mock('../opencode/client.js', () => ({
  opencodeClient: {
    patchSession: (...args: unknown[]) => patchSession(...args),
    promptAsync: (...args: unknown[]) => promptAsync(...args),
  },
}));

vi.mock('../opencode/store.js', () => ({
  getOpenCodeStore: () => ({
    markSessionOptimisticBusy,
  }),
}));

import { sendOpenCodePrompt } from './agent.js';

describe('sendOpenCodePrompt permission mode', () => {
  beforeEach(() => {
    patchSession.mockReset();
    promptAsync.mockReset();
    markSessionOptimisticBusy.mockReset();
    patchSession.mockResolvedValue(undefined);
    promptAsync.mockResolvedValue(undefined);
  });

  const base = {
    paneId: 'pane-1',
    sessionId: 'sess-1',
    parts: [{ type: 'text' as const, text: 'hi' }],
    messageId: 'msg_test',
  };

  it('default does not PATCH session permission', async () => {
    await sendOpenCodePrompt(base);
    expect(patchSession).not.toHaveBeenCalled();
    expect(promptAsync).toHaveBeenCalledWith('pane-1', 'sess-1', {
      messageID: 'msg_test',
      parts: base.parts,
      agent: undefined,
      model: undefined,
    });
  });

  it('explicit allow PATCHes session then prompts', async () => {
    await sendOpenCodePrompt({
      ...base,
      permissionModeUserPicked: true,
      permissionMode: 'allow',
    });
    expect(patchSession).toHaveBeenCalledWith('pane-1', 'sess-1', {
      permission: [{ permission: '*', pattern: '*', action: 'allow' }],
    });
    expect(promptAsync).toHaveBeenCalledTimes(1);
    const body = promptAsync.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body).not.toHaveProperty('permission');
  });

  it('explicit ask PATCHes session with ask action', async () => {
    await sendOpenCodePrompt({
      ...base,
      permissionModeUserPicked: true,
      permissionMode: 'ask',
    });
    expect(patchSession).toHaveBeenCalledWith('pane-1', 'sess-1', {
      permission: [{ permission: '*', pattern: '*', action: 'ask' }],
    });
  });
});
