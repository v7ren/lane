import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  mergeEnvelopeLog,
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

describe('mergeEnvelopeLog (epoch, seq) key', () => {
  const mk = (epoch: number | undefined, seq: number) => ({
    pane_id: 'p',
    seq,
    epoch,
    event: { type: 'error' as const, message: `${epoch}:${seq}` },
  });

  it('keeps events whose seq restarted in a new epoch', () => {
    const old = mergeEnvelopeLog([], [mk(1, 1), mk(1, 2), mk(1, 3)]);
    const next = mergeEnvelopeLog(old, [mk(2, 1), mk(2, 2)]);
    expect(next.map((e) => `${e.epoch}:${e.seq}`)).toEqual(['1:1', '1:2', '1:3', '2:1', '2:2']);
  });

  it('still dedups the same (epoch, seq) and treats a missing epoch as 0', () => {
    const log = mergeEnvelopeLog([], [mk(undefined, 1), mk(0, 2)]);
    expect(mergeEnvelopeLog(log, [mk(0, 1), mk(undefined, 2)])).toBe(log);
  });
});
