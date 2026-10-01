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

  it('maps user role and clears typing after completion and turn end', () => {
    const vm = reduceAgentTimeline(
      [],
      [
        env(1, { type: 'turn_started', turn_id: 't1' }),
        env(2, {
          type: 'message_delta',
          turn_id: 't1',
          message_id: 'u1',
          role: 'user',
          text: 'hi',
        }),
        env(3, {
          type: 'message_completed',
          turn_id: 't1',
          message_id: 'u1',
          role: 'user',
          text: 'hi',
        }),
        env(4, { type: 'turn_completed', turn_id: 't1', status: 'ok' }),
      ],
    );
    expect(vm.messages).toHaveLength(1);
    expect(vm.messages[0]?.role).toBe('user');
    expect(vm.messages[0]?.streaming).toBe(false);
  });

  it('keeps reasoning separate from assistant text', () => {
    const vm = reduceAgentTimeline(
      [],
      [
        env(1, {
          type: 'message_delta',
          turn_id: 't1',
          message_id: 'a1',
          role: 'assistant',
          text: 'think',
          content_kind: 'reasoning',
        }),
        env(2, {
          type: 'message_completed',
          turn_id: 't1',
          message_id: 'a1',
          role: 'assistant',
          text: 'think',
          content_kind: 'reasoning',
          duration_ms: 2200,
        }),
        env(3, {
          type: 'message_delta',
          turn_id: 't1',
          message_id: 'a1',
          role: 'assistant',
          text: 'Hi!',
        }),
        env(4, {
          type: 'message_completed',
          turn_id: 't1',
          message_id: 'a1',
          role: 'assistant',
          text: 'Hi!',
        }),
      ],
    );
    expect(vm.messages).toHaveLength(1);
    expect(vm.messages[0]?.reasoning).toBe('think');
    expect(vm.messages[0]?.text).toBe('Hi!');
    expect(vm.messages[0]?.reasoningDurationMs).toBe(2200);
  });

  it('does not duplicate messages for the same message id', () => {
    const vm = reduceAgentTimeline(
      [],
      [
        env(1, {
          type: 'message_delta',
          turn_id: 't1',
          message_id: 'm1',
          role: 'assistant',
          text: 'a',
        }),
        env(2, {
          type: 'message_delta',
          turn_id: 't1',
          message_id: 'm1',
          role: 'assistant',
          text: 'b',
        }),
      ],
    );
    expect(vm.messages).toHaveLength(1);
    expect(vm.messages[0]?.text).toBe('ab');
  });

  it('mergeAgentEventEnvelopes skips already applied seq', () => {
    const base = mergeAgentEventEnvelopes(
      { ...reduceAgentTimeline([], [env(1, { type: 'turn_started', turn_id: 't' })]), maxSeq: 1 },
      [env(1, { type: 'error', message: 'ignored' }), env(2, { type: 'error', message: 'new' })],
    );
    expect(base.lastError).toBe('new');
    expect(base.maxSeq).toBe(2);
  });

  it('stores notices by id: a repeat replaces, cleared removes', () => {
    const base = { type: 'notice', level: 'info', sticky: false } as const;
    let vm = reduceAgentTimeline(
      [],
      [
        env(1, { ...base, id: 'n1', text: 'one' }),
        env(2, { ...base, id: 'n2', text: 'two', level: 'warning', sticky: true }),
        env(3, { ...base, id: 'n1', text: 'one again' }),
      ],
    );
    expect(vm.notices.map((n) => [n.id, n.text, n.sticky])).toEqual([
      ['n1', 'one again', false],
      ['n2', 'two', true],
    ]);
    vm = mergeAgentEventEnvelopes(vm, [
      env(4, { type: 'notice', id: 'n1', level: 'info', text: '', cleared: true }),
    ]);
    expect(vm.notices.map((n) => n.id)).toEqual(['n2']);
  });

  it('keeps the latest plan (replace, not merge) and ignores tool output deltas', () => {
    const vm = reduceAgentTimeline(
      [],
      [
        env(1, { type: 'plan_updated', items: [{ text: 'a', status: 'pending' }] }),
        env(2, {
          type: 'plan_updated',
          items: [{ text: 'b', status: 'in_progress' }],
          explanation: 'why',
        }),
        env(3, { type: 'tool_output_delta', turn_id: 't1', tool_id: 'x', chunk: 'hi' }),
      ],
    );
    expect(vm.plan?.items).toEqual([{ text: 'b', status: 'in_progress' }]);
    expect(vm.plan?.explanation).toBe('why');
    expect(vm.tools).toEqual([]);
    expect(vm.maxSeq).toBe(3);
  });

  it('carries the approval payload and usage context fields', () => {
    const vm = reduceAgentTimeline(
      [],
      [
        env(1, {
          type: 'approval_requested',
          approval_id: 'a1',
          title: 'Run',
          detail: 'ls',
          kind: 'command',
          options: ['allow_once', 'deny'],
          payload: { type: 'command', command: 'ls' },
        }),
        env(2, { type: 'usage', input_tokens: 1, context_tokens: 90, context_window: 200 }),
      ],
    );
    expect(vm.pendingApprovals[0]?.payload).toEqual({ type: 'command', command: 'ls' });
    expect(vm.usage?.context_tokens).toBe(90);
    expect(vm.usage?.context_window).toBe(200);
  });
});
