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

  it('renders historical session with user row and assistant reply after hydrate', () => {
    let state = createEmptyOpenCodeStore('pane-test');
    const sessionId = 'sess_hist';
    state = applyOpenCodeWireEvent(state, {
      id: 'e1',
      type: 'message.updated',
      properties: {
        info: { id: 'msg_u', sessionID: sessionId, role: 'user', time: { created: 1 } },
      },
    } as OpenCodeWireEvent);
    state = applyOpenCodeWireEvent(state, {
      id: 'e2',
      type: 'message.part.updated',
      properties: {
        messageID: 'msg_u',
        part: { id: 'p_u', messageID: 'msg_u', type: 'text', text: 'hello' },
      },
    } as OpenCodeWireEvent);
    state = applyOpenCodeWireEvent(state, {
      id: 'e3',
      type: 'message.updated',
      properties: {
        info: { id: 'msg_a', sessionID: sessionId, role: 'assistant', time: { created: 2 } },
      },
    } as OpenCodeWireEvent);
    state = applyOpenCodeWireEvent(state, {
      id: 'e4',
      type: 'message.part.updated',
      properties: {
        messageID: 'msg_a',
        part: { id: 'p_a', messageID: 'msg_a', type: 'text', text: 'hi' },
      },
    } as OpenCodeWireEvent);

    const vm = fromOpenCode(state, sessionId);
    expect(vm.turns.some((t) => t.role === 'user')).toBe(true);
    expect(vm.turns.some((t) => t.role === 'assistant')).toBe(true);
  });

  it('builds assistant content when parts arrive before message.updated', () => {
    let state = createEmptyOpenCodeStore('pane-test');
    const sessionId = 'sess_parts_first';
    const messageId = 'msg_a';
    state = applyOpenCodeWireEvent(state, {
      id: 'e1',
      type: 'message.part.updated',
      properties: {
        sessionID: sessionId,
        messageID: messageId,
        part: { id: 'p1', messageID: messageId, type: 'text', text: 'early' },
      },
    } as OpenCodeWireEvent);

    const vm = fromOpenCode(state, sessionId);
    const assistant = vm.turns.find((t) => t.role === 'assistant');
    expect(assistant?.items.some((i) => i.kind === 'assistant_text')).toBe(true);
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

  it('orders hello-read multi-step turn like live E2E', () => {
    const events = loadFixture('hello-read-turn.json');
    const state = replay(events);
    const vm = fromOpenCode(state, 'sess_hello');
    const kinds = vm.turns.map((t) => ({
      role: t.role,
      items: t.items.map((i) => i.kind),
    }));
    expect(kinds[0]?.role).toBe('user');
    expect(kinds[1]?.items).toEqual(['reasoning', 'tool_call', 'step_usage']);
    expect(kinds[2]?.items).toEqual(['reasoning', 'assistant_text', 'step_usage']);
    const readIdx = kinds[1]?.items.indexOf('tool_call');
    const textIdx = kinds[2]?.items.indexOf('assistant_text');
    expect(readIdx).toBeGreaterThan(-1);
    expect(textIdx).toBeGreaterThan(-1);
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

  it('shows session rate limit as inline transcript row after lone user turn', () => {
    const sessionId = 'sess_rate';
    let state = createEmptyOpenCodeStore('pane-test');
    state = applyOpenCodeWireEvent(state, {
      id: 'u1',
      type: 'message.updated',
      properties: {
        info: { id: 'msg_u1', sessionID: sessionId, role: 'user', time: { created: 1 } },
      },
    } as OpenCodeWireEvent);
    state = applyOpenCodeWireEvent(state, {
      id: 'e_rate',
      type: 'session.error',
      properties: {
        sessionID: sessionId,
        error: { message: 'Rate limit exceeded', retry_at_ms: 1_700_000_000_000 },
      },
    } as OpenCodeWireEvent);

    const vm = fromOpenCode(state, sessionId);
    expect(vm.turns).toHaveLength(2);
    expect(vm.turns[1]?.role).toBe('assistant');
    expect(vm.turns[1]?.items[0]?.kind).toBe('retry');
    if (vm.turns[1]?.items[0]?.kind === 'retry') {
      expect(vm.turns[1].items[0].message).toContain('Rate limit');
      expect(vm.turns[1].items[0].retryAtMs).toBe(1_700_000_000_000);
    }
    expect(vm.rateLimit?.message).toContain('Rate limit');
  });
});
