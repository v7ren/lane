import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentEventEnvelope } from '../agent-events';
import { fromAgentEventEnvelopes, fromAgentTimeline } from './from-agent-events';
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
    expect(vm.turns).toHaveLength(1);
    expect(vm.turns[0]?.items.some((i) => i.kind === 'user_prompt')).toBe(true);
    expect(vm.turns[0]?.items.some((i) => i.kind === 'assistant_text')).toBe(true);
    expect(vm.turns[0]?.meta?.model).toBe('mimo-v2.5');
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
