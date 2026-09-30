import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentEventEnvelope } from '../agent-events';
import { fromAgentEventEnvelopes, fromAgentTimeline } from './from-agent-events';
import type { TranscriptItem, TranscriptViewModel } from './types';
import { reduceAgentTimeline } from '../agent-timeline-reducer';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../src-tauri/tests/fixtures');

function envelope(seq: number, event: AgentEvent): AgentEventEnvelope {
  return { pane_id: 'p1', seq, event };
}

describe('fromAgentEvents adapter', () => {
  it('builds user and assistant turns from envelopes', () => {
    const vm = fromAgentEventEnvelopes([
      envelope(1, { type: 'turn_started', turn_id: 't1' }),
      envelope(2, {
        type: 'message_completed',
        turn_id: 't1',
        message_id: 'u1',
        role: 'user',
        text: 'hello',
      }),
      envelope(3, {
        type: 'message_completed',
        turn_id: 't1',
        message_id: 'a1',
        role: 'assistant',
        text: 'hi there',
      }),
      envelope(4, {
        type: 'message_meta',
        turn_id: 't1',
        message_id: 'a1',
        agent: 'build',
        model: 'mimo-v2.5',
        duration_ms: 6100,
      }),
      envelope(5, { type: 'turn_completed', turn_id: 't1', status: 'ok' }),
    ]);
    expect(vm.turns.map((t) => t.role)).toEqual(['user', 'assistant']);
    expect(vm.turns[0]?.items[0]?.kind).toBe('user_prompt');
    expect(vm.turns[1]?.items.some((i) => i.kind === 'assistant_text')).toBe(true);
    expect(vm.turns[1]?.meta?.model).toBe('mimo-v2.5');
  });

  it('maps codex fixture sequence names via contract events', () => {
    const sequences = JSON.parse(
      readFileSync(join(FIXTURE_DIR, 'agent_event_sequences.json'), 'utf8'),
    ) as Record<string, string[]>;
    for (const name of ['codex_prompt_ok', 'claude_prompt_ok', 'opencode_prompt_ok']) {
      const turnId = 't-fixture';
      const envelopes = sequences[name]!.map((type, index) => {
        const event = minimalEvent(type, turnId);
        return envelope(index + 1, event);
      });
      const vm = fromAgentEventEnvelopes(envelopes);
      expect(vm.flatItems.length).toBeGreaterThan(0);
    }
  });

  it('bridges legacy timeline view model', () => {
    const timeline = reduceAgentTimeline(
      [],
      [
        envelope(1, {
          type: 'message_completed',
          turn_id: 't1',
          message_id: 'u1',
          role: 'user',
          text: 'x',
        }),
      ],
    );
    const vm = fromAgentTimeline(timeline);
    expect(vm.turns[0]?.items[0]?.kind).toBe('user_prompt');
  });
});

function run(events: AgentEvent[]) {
  const envelopes = events.map((event, i) => envelope(i + 1, event));
  return {
    legacy: fromAgentTimeline(reduceAgentTimeline([], envelopes)),
    next: fromAgentEventEnvelopes(envelopes),
  };
}

/** Comparable shape: turn roles plus order-insensitive item signatures (usage ids excluded, error items optional). */
function shape(vm: TranscriptViewModel, opts: { dropErrors?: boolean } = {}) {
  const sig = (item: TranscriptItem): string => {
    if (item.kind === 'step_usage') return JSON.stringify({ ...item, id: 'usage' });
    return JSON.stringify(item);
  };
  return vm.turns.map((t) => ({
    role: t.role,
    items: t.items
      .filter((i) => !(opts.dropErrors && i.kind === 'error'))
      .map(sig)
      .sort(),
  }));
}

function expectParity(events: AgentEvent[]) {
  const { legacy, next } = run(events);
  expect(shape(next, { dropErrors: true })).toEqual(shape(legacy));
  expect(next.turnActive).toBe(legacy.turnActive);
  expect(next.sessionBusy).toBe(legacy.sessionBusy);
  expect(next.lastError).toBe(legacy.lastError);
  expect(next.rateLimit).toEqual(legacy.rateLimit);
  expect(next.globalFilePaths).toEqual(legacy.globalFilePaths);
  return { legacy, next };
}

const userMsg = (text: string): AgentEvent => ({
  type: 'message_completed',
  turn_id: 't1',
  message_id: 'u1',
  role: 'user',
  text,
});

describe('fromAgentEventEnvelopes parity with fromAgentTimeline', () => {
  it('text turn with streaming, meta and usage', () => {
    const { next } = expectParity([
      { type: 'turn_started', turn_id: 't1' },
      userMsg('hi'),
      { type: 'message_delta', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'hel' },
      { type: 'message_delta', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'lo' },
      { type: 'message_completed', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'hello' },
      { type: 'message_meta', turn_id: 't1', message_id: 'a1', agent: 'build', model: 'm', duration_ms: 10 },
      { type: 'usage', input_tokens: 3, output_tokens: 4, cost_usd: 0.5 },
      { type: 'turn_completed', turn_id: 't1', status: 'ok' },
    ]);
    expect(next.turnActive).toBe(false);
    expect(next.turns).toHaveLength(2);
  });

  it('mid-stream turn stays active and streaming', () => {
    const { next } = expectParity([
      { type: 'turn_started', turn_id: 't1' },
      { type: 'message_delta', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'par' },
    ]);
    expect(next.turnActive).toBe(true);
  });

  it('tool turn with error output', () => {
    const { next } = expectParity([
      { type: 'turn_started', turn_id: 't1' },
      { type: 'message_completed', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'running' },
      { type: 'tool_started', turn_id: 't1', tool_id: 'x1', name: 'bash', input_summary: 'ls' },
      { type: 'tool_completed', turn_id: 't1', tool_id: 'x1', status: 'error', output_summary: 'boom' },
      { type: 'turn_completed', turn_id: 't1', status: 'ok' },
    ]);
    const tool = next.flatItems.find((i) => i.kind === 'tool_call');
    expect(tool).toMatchObject({ name: 'bash', status: 'error', output: 'boom' });
  });

  it('cancelled turn clears turnActive', () => {
    const { next } = expectParity([
      { type: 'turn_started', turn_id: 't1' },
      { type: 'message_delta', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'partial' },
      { type: 'turn_completed', turn_id: 't1', status: 'cancelled' },
    ]);
    expect(next.turnActive).toBe(false);
    const text = next.flatItems.find((i) => i.kind === 'assistant_text');
    expect(text).toMatchObject({ streaming: false });
  });

  it('errored turn clears turnActive and surfaces the error', () => {
    const { legacy, next } = run([
      { type: 'turn_started', turn_id: 't1' },
      { type: 'message_delta', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'x' },
      { type: 'turn_completed', turn_id: 't1', status: 'error', error: 'kaput' },
    ]);
    expect(legacy.turnActive).toBe(false);
    expect(next.turnActive).toBe(false);
    expect(next.lastError).toBe('kaput');
    expect(next.lastError).toBe(legacy.lastError);
    expect(next.flatItems).toContainEqual({ kind: 'error', id: 'error-t1', message: 'kaput' });
  });

  it('files_changed yields a patch item on the last assistant turn', () => {
    const { next } = expectParity([
      { type: 'turn_started', turn_id: 't1' },
      { type: 'message_completed', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'done' },
      { type: 'files_changed', paths: ['a.ts', 'b.ts'] },
      { type: 'files_changed', paths: ['b.ts', 'c.ts'] },
      { type: 'turn_completed', turn_id: 't1', status: 'ok' },
    ]);
    expect(next.flatItems.filter((i) => i.kind === 'patch')).toEqual([
      { kind: 'patch', id: 'files-changed', paths: ['a.ts', 'b.ts', 'c.ts'] },
    ]);
  });

  it('rate_limited sets the banner', () => {
    const { next } = expectParity([
      { type: 'turn_started', turn_id: 't1' },
      { type: 'rate_limited', message: 'slow down', retry_at_ms: 99 },
    ]);
    expect(next.rateLimit).toEqual({ message: 'slow down', retryAtMs: 99 });
  });

  it('standalone error event becomes an error item and lastError', () => {
    const { legacy, next } = run([
      { type: 'turn_started', turn_id: 't1' },
      { type: 'message_completed', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'x' },
      { type: 'error', message: 'bridge down' },
    ]);
    expect(next.lastError).toBe(legacy.lastError);
    expect(next.flatItems.filter((i) => i.kind === 'error')).toHaveLength(1);
    const orphan = run([{ type: 'error', message: 'early' }]).next;
    expect(orphan.flatItems).toEqual([expect.objectContaining({ kind: 'error', message: 'early' })]);
  });
});

describe('fromAgentEventEnvelopes tool and turn attachment', () => {
  it('tool_completed for an unseen tool uses title, else "tool"', () => {
    const titled = run([
      { type: 'tool_completed', turn_id: 't1', tool_id: 'x', status: 'ok', output_summary: 'o', title: 'Read file' },
    ]).next;
    expect(titled.flatItems[0]).toMatchObject({ kind: 'tool_call', name: 'Read file', status: 'completed' });
    const bare = run([
      { type: 'tool_completed', turn_id: 't1', tool_id: 'x', status: 'ok', output_summary: 'o' },
    ]).next;
    expect(bare.flatItems[0]).toMatchObject({ kind: 'tool_call', name: 'tool' });
  });

  it('attaches tools to the turn named by turn_id, even before any text', () => {
    const vm = fromAgentEventEnvelopes([
      envelope(1, { type: 'turn_started', turn_id: 't1' }),
      envelope(2, { type: 'message_completed', turn_id: 't1', message_id: 'a1', role: 'assistant', text: 'one' }),
      envelope(3, { type: 'tool_started', turn_id: 't2', tool_id: 'x2', name: 'bash', input_summary: 'pwd' }),
      envelope(4, { type: 'tool_started', turn_id: 't1', tool_id: 'x1', name: 'bash', input_summary: 'ls' }),
      envelope(5, { type: 'tool_completed', turn_id: 't2', tool_id: 'x2', status: 'ok', output_summary: 'p' }),
    ]);
    const byId = Object.fromEntries(vm.turns.map((t) => [t.id, t.items.map((i) => i.id)]));
    expect(byId.t1).toEqual(['a1-text', 'x1']);
    expect(byId.t2).toEqual(['x2']);
    const t2Tool = vm.turns.find((t) => t.id === 't2')?.items[0];
    expect(t2Tool).toMatchObject({ status: 'completed', name: 'bash' });
  });

  it('tool_completed keeps the started name and its turn', () => {
    const vm = fromAgentEventEnvelopes([
      envelope(1, { type: 'tool_started', turn_id: 't1', tool_id: 'x', name: 'bash', input_summary: 'ls' }),
      envelope(2, { type: 'tool_completed', turn_id: 't1', tool_id: 'x', status: 'ok', output_summary: 'out', title: 'Shell' }),
    ]);
    expect(vm.flatItems).toHaveLength(1);
    expect(vm.flatItems[0]).toMatchObject({ name: 'bash', title: 'Shell', input: 'ls', output: 'out' });
  });
});

function minimalEvent(type: string, turnId: string): AgentEvent {
  switch (type) {
    case 'turn_started':
      return { type: 'turn_started', turn_id: turnId };
    case 'message_delta':
      return {
        type: 'message_delta',
        turn_id: turnId,
        message_id: 'm1',
        role: 'assistant',
        text: 'partial ',
      };
    case 'turn_completed':
      return { type: 'turn_completed', turn_id: turnId, status: 'ok' };
    default:
      return { type: 'turn_completed', turn_id: turnId, status: 'ok' };
  }
}
