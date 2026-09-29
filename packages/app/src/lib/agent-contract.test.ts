import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, AgentEventEnvelope } from './agent-events';
import { reduceAgentTimeline } from './agent-timeline-reducer';

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../src-tauri/tests/fixtures/agent_event_sequences.json',
);

type SequenceName = keyof typeof sequences;

const sequences = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, string[]>;

function envelope(seq: number, event: AgentEvent): AgentEventEnvelope {
  return { pane_id: 'fixture-pane', seq, event };
}

/** Build a minimal valid event for each fixture type name (snake_case contract). */
function eventForType(type: string, ctx: { turnId: string; seq: number }): AgentEvent {
  switch (type) {
    case 'turn_started':
      return { type: 'turn_started', turn_id: ctx.turnId };
    case 'message_delta':
      return {
        type: 'message_delta',
        turn_id: ctx.turnId,
        message_id: 'm1',
        role: 'assistant',
        text: 'partial ',
      };
    case 'message_completed':
      return {
        type: 'message_completed',
        turn_id: ctx.turnId,
        message_id: 'm1',
        role: 'assistant',
        text: 'partial done',
      };
    case 'tool_started':
      return {
        type: 'tool_started',
        turn_id: ctx.turnId,
        tool_id: 'tool1',
        name: 'bash',
        input_summary: 'ls',
      };
    case 'tool_completed':
      return {
        type: 'tool_completed',
        turn_id: ctx.turnId,
        tool_id: 'tool1',
        status: 'ok',
        output_summary: 'listed',
      };
    case 'approval_requested':
      return {
        type: 'approval_requested',
        approval_id: 'a1',
        title: 'Run',
        detail: 'cmd',
        kind: 'command',
        options: ['allow_once', 'deny'],
      };
    case 'approval_resolved':
      return { type: 'approval_resolved', approval_id: 'a1', decision: 'deny' };
    case 'turn_completed':
      return { type: 'turn_completed', turn_id: ctx.turnId, status: 'ok' };
    default:
      throw new Error(`fixture type ${type} is not in the TS AgentEvent contract`);
  }
}

function sequenceToEnvelopes(typeNames: string[]): AgentEventEnvelope[] {
  const turnId = 't-fixture';
  return typeNames.map((type, index) =>
    envelope(index + 1, eventForType(type, { turnId, seq: index + 1 })),
  );
}

describe('agent contract fixture sequences', () => {
  for (const [name, typeNames] of Object.entries(sequences) as [SequenceName, string[]][]) {
    it(`reduces ${name} into a sane timeline`, () => {
      const envelopes = sequenceToEnvelopes(typeNames);
      const vm = reduceAgentTimeline([], envelopes);

      expect(vm.maxSeq).toBe(typeNames.length);

      if (typeNames.includes('message_delta') || typeNames.includes('message_completed')) {
        expect(vm.messages.length).toBeGreaterThan(0);
        const last = vm.messages[vm.messages.length - 1];
        const finalized =
          typeNames.includes('message_completed') || typeNames.includes('turn_completed');
        expect(last.streaming).toBe(finalized ? false : true);
      }

      if (typeNames.includes('tool_started') && typeNames.includes('tool_completed')) {
        const tool = vm.tools.find((t) => t.id === 'tool1');
        expect(tool?.status).toBe('ok');
      }

      if (typeNames.includes('approval_requested')) {
        expect(vm.approvals.length).toBeGreaterThan(0);
      }
      if (typeNames.includes('approval_resolved')) {
        expect(vm.pendingApprovals).toHaveLength(0);
        expect(vm.approvals.some((a) => a.resolved !== undefined)).toBe(true);
      }

      if (typeNames.includes('turn_completed')) {
        expect(vm.turnActive).toBe(false);
      } else if (typeNames.includes('turn_started')) {
        expect(vm.turnActive).toBe(true);
      }
    });
  }

  it('fixture event type names match AgentEvent union tags', () => {
    const allowed = new Set([
      'turn_started',
      'message_delta',
      'message_completed',
      'tool_started',
      'tool_completed',
      'approval_requested',
      'approval_resolved',
      'files_changed',
      'usage',
      'rate_limited',
      'turn_completed',
      'error',
    ]);
    for (const typeNames of Object.values(sequences)) {
      for (const t of typeNames) {
        expect(allowed.has(t), `unknown fixture type ${t}`).toBe(true);
      }
    }
  });
});
