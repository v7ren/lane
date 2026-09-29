import { describe, expect, it } from 'vitest';
import type { AgentEventEnvelope } from './agent-events';
import { mergeAgentEventEnvelopes, reduceAgentTimeline } from './agent-timeline-reducer';

function env(seq: number, event: AgentEventEnvelope['event']): AgentEventEnvelope {
  return { pane_id: 'p1', seq, event };
}

describe('agent-timeline-reducer', () => {
  it('merges message deltas into streaming then completed text', () => {
    const vm = reduceAgentTimeline(
      [],
      [
        env(1, { type: 'turn_started', turn_id: 't1' }),
        env(2, {
          type: 'message_delta',
          turn_id: 't1',
          message_id: 'm1',
          role: 'assistant',
          text: 'Hel',
        }),
        env(3, {
          type: 'message_delta',
          turn_id: 't1',
          message_id: 'm1',
          role: 'assistant',
          text: 'lo',
        }),
        env(4, {
          type: 'message_completed',
          turn_id: 't1',
          message_id: 'm1',
          role: 'assistant',
          text: 'Hello world',
        }),
      ],
    );
    expect(vm.messages).toHaveLength(1);
    expect(vm.messages[0].text).toBe('Hello world');
    expect(vm.messages[0].streaming).toBe(false);
    expect(vm.turnActive).toBe(true);
  });

  it('dedupes by seq and tolerates out-of-order delivery', () => {
    const envelopes = [
      env(3, {
        type: 'message_completed',
        turn_id: 't1',
        message_id: 'm1',
        role: 'user',
        text: 'done',
      }),
      env(1, { type: 'turn_started', turn_id: 't1' }),
      env(2, {
        type: 'message_delta',
        turn_id: 't1',
        message_id: 'm1',
        role: 'user',
        text: 'do',
      }),
      env(2, {
        type: 'message_delta',
        turn_id: 't1',
        message_id: 'm1',
        role: 'user',
        text: 'dup',
      }),
    ];
    const vm = reduceAgentTimeline([], envelopes);
    expect(vm.maxSeq).toBe(3);
    expect(vm.messages[0]?.text).toBe('done');
  });

  it('tracks approval request and resolve', () => {
    const vm = reduceAgentTimeline(
      [],
      [
        env(1, {
          type: 'approval_requested',
          approval_id: 'a1',
          title: 'Run command',
          detail: 'npm test',
          kind: 'command',
          options: ['allow_once', 'deny'],
        }),
        env(2, { type: 'approval_resolved', approval_id: 'a1', decision: 'allow_once' }),
      ],
    );
    expect(vm.pendingApprovals).toHaveLength(0);
    expect(vm.approvals[0]?.resolved).toBe('allow_once');
  });

  it('mergeAgentEventEnvelopes skips already applied seq', () => {
    const base = mergeAgentEventEnvelopes(
      { ...reduceAgentTimeline([], [env(1, { type: 'turn_started', turn_id: 't' })]), maxSeq: 1 },
      [env(1, { type: 'error', message: 'ignored' }), env(2, { type: 'error', message: 'new' })],
    );
    expect(base.lastError).toBe('new');
    expect(base.maxSeq).toBe(2);
  });
});
