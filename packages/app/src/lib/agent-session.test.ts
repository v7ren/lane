import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  sessionCancelTurn,
  sessionRespondApprovalInvokePayload,
  sessionSendPrompt,
  sessionSendPromptInvokePayload,
} from './agent-session';

const invokeMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock('./is-tauri', () => ({
  isTauriRuntime: () => true,
}));

describe('agent-session invoke contract', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it('session_send_prompt uses snake_case fields inside args struct', () => {
    expect(sessionSendPromptInvokePayload('pane-1', 'hello')).toEqual({
      args: { pane_id: 'pane-1', text: 'hello' },
    });
    expect(sessionSendPromptInvokePayload('pane-1', 'hello').args).not.toHaveProperty('paneId');
  });

  it('session_respond_approval uses snake_case fields inside args struct', () => {
    expect(sessionRespondApprovalInvokePayload('pane-1', 'apr-1', 'allow_once')).toEqual({
      args: { pane_id: 'pane-1', approval_id: 'apr-1', decision: 'allow_once' },
    });
  });

  it('sessionSendPrompt forwards the contract payload to invoke', async () => {
    await sessionSendPrompt('pane-abc', 'ping');
    expect(invokeMock).toHaveBeenCalledWith(
      'session_send_prompt',
      sessionSendPromptInvokePayload('pane-abc', 'ping'),
    );
  });

  it('session_cancel_turn uses flat paneId (not nested args)', async () => {
    await sessionCancelTurn('pane-xyz');
    expect(invokeMock).toHaveBeenCalledWith('session_cancel_turn', { paneId: 'pane-xyz' });
  });
});
