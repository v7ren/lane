import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OpenCodeWireEvent } from '@loomria/shared/opencode';

import { applyOpenCodeWireEvent, createEmptyOpenCodeStore } from '../opencode/store.js';
import { fromOpenCode } from './from-opencode.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../opencode/__fixtures__');

function replay(events: OpenCodeWireEvent[]) {
  let state = createEmptyOpenCodeStore('pane-test');
  for (const event of events) {
    state = applyOpenCodeWireEvent(state, event);
  }
  return state;
}

function loadFixture(name: string): OpenCodeWireEvent[] {
  const raw = JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8')) as {
    events: OpenCodeWireEvent[];
  };
  return raw.events;
}

describe('fromOpenCode adapter', () => {
  it('replays synthetic-events into turns with tool and usage', () => {
    const state = replay(loadFixture('synthetic-events.json'));
    const vm = fromOpenCode(state, 'sess_test');
    expect(vm.turns.length).toBeGreaterThanOrEqual(2);
    const user = vm.turns.find((t) => t.role === 'user');
    expect(user?.items[0]?.kind).toBe('user_prompt');
    const assistant = vm.turns.find((t) => t.role === 'assistant');
    expect(assistant?.items.some((i) => i.kind === 'assistant_text')).toBe(true);
    expect(assistant?.items.some((i) => i.kind === 'tool_call')).toBe(true);
    expect(assistant?.items.some((i) => i.kind === 'step_usage')).toBe(true);
  });

  it('orders assistant items by arrival order when timestamps disagree', () => {
    let state = createEmptyOpenCodeStore('pane-test');
    const sessionId = 'sess_order';
    const messageId = 'msg_asst';
    state = applyOpenCodeWireEvent(state, {
      id: 'e1',
      type: 'message.updated',
      properties: {
        info: { id: messageId, sessionID: sessionId, role: 'assistant', time: { created: 1 } },
      },
    } as OpenCodeWireEvent);
    state = applyOpenCodeWireEvent(state, {
      id: 'e2',
      type: 'message.part.updated',
      properties: {
        messageID: messageId,
        part: {
          id: 'part_text',
          messageID: messageId,
          type: 'text',
          text: 'hello',
          time: { start: 20, end: 21 },
        },
      },
    } as OpenCodeWireEvent);
    state = applyOpenCodeWireEvent(state, {
      id: 'e3',
      type: 'message.part.updated',
      properties: {
        messageID: messageId,
        part: {
          id: 'part_tool',
          messageID: messageId,
          type: 'tool',
          tool: 'read',
          state: { status: 'completed' },
          time: { start: 5, end: 10 },
        },
      },
    } as OpenCodeWireEvent);

    const vm = fromOpenCode(state, sessionId);
    const assistant = vm.turns.find((t) => t.role === 'assistant');
    const kinds = assistant?.items.map((i) => i.kind);
    expect(kinds?.indexOf('assistant_text')).toBeLessThan(kinds?.indexOf('tool_call') ?? 999);
  });

  it('replays out-of-order multi-step turn fixture', () => {
    const events = loadFixture('out-of-order-turn.json');
    const state = replay(events);
    const vm = fromOpenCode(state, 'sess_order');
    expect(vm.turns[0]?.role).toBe('user');
    const assistant2 = vm.turns.find((t) => t.id === 'msg_asst_2');
    const kinds = assistant2?.items.map((i) => i.kind) ?? [];
    expect(kinds.indexOf('tool_call')).toBeLessThan(kinds.indexOf('assistant_text'));
  });

  it('builds user turn from part deltas when prompt only streams', () => {
    let state = createEmptyOpenCodeStore('pane-test');
    const sessionId = 'sess_tui';
    const messageId = 'msg_user';
    state = applyOpenCodeWireEvent(state, {
      id: 'e1',
      type: 'message.updated',
      properties: {
        info: { id: messageId, sessionID: sessionId, role: 'user', time: { created: 1 } },
      },
    } as OpenCodeWireEvent);
    state = applyOpenCodeWireEvent(state, {
      id: 'e2',
      type: 'message.part.delta',
      properties: {
        messageID: messageId,
        partID: 'part_u',
        field: 'text',
        delta: 'from tui',
      },
    } as OpenCodeWireEvent);

    const vm = fromOpenCode(state, sessionId);
    const user = vm.turns.find((t) => t.role === 'user');
    expect(user?.items[0]?.kind).toBe('user_prompt');
    if (user?.items[0]?.kind === 'user_prompt') {
      expect(user.items[0].text).toBe('from tui');
    }
  });

  it('replays live-turn.json without throwing', () => {
    const events = loadFixture('live-turn.json');
    const state = replay(events);
    const sessionId =
      state.sessionOrder[0] ??
      Object.values(state.sessions)[0]?.id ??
      'ses_f118210aaffemx5qW1KNcWbJP5';
    const vm = fromOpenCode(state, sessionId);
    expect(vm.turns.length).toBeGreaterThan(0);
  });
});
