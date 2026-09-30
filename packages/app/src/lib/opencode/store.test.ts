import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { OpenCodeWireEvent } from '@loomria/shared/opencode';

import {
  assembleMessageText,
  finalTextPartForMessage,
  selectMessages,
  selectPermissions,
  selectSessionSummary,
  selectSessionStatus,
} from './selectors.js';
import {
  applyOpenCodeWireEvent,
  createEmptyOpenCodeStore,
} from './store.js';
import { markOptimisticBusy, applySessionStatusSnapshot } from './session-status.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

type FixtureFile = {
  events: OpenCodeWireEvent[];
  promptCount?: number;
};

function loadFixture(name: string): OpenCodeWireEvent[] {
  const raw = JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8')) as FixtureFile;
  return raw.events;
}

function fixtureSessionId(events: OpenCodeWireEvent[]): string {
  const created = events.find((e) => e.type === 'session.created');
  const props = created?.properties ?? {};
  const info = props.info as { id?: string } | undefined;
  return (
    (typeof props.sessionID === 'string' ? props.sessionID : undefined) ??
    info?.id ??
    ''
  );
}

function replay(events: OpenCodeWireEvent[]) {
  let state = createEmptyOpenCodeStore('pane-test');
  for (const event of events) {
    state = applyOpenCodeWireEvent(state, event);
  }
  return state;
}

describe('OpenCode store replay', () => {
  const events = loadFixture('synthetic-events.json');

  it('tracks user vs assistant roles', () => {
    const state = replay(events);
    const messages = selectMessages(state, 'sess_test');
    expect(messages.find((m) => m.id === 'msg_user')?.role).toBe('user');
    expect(messages.find((m) => m.id === 'msg_asst')?.role).toBe('assistant');
  });

  it('applies text deltas', () => {
    const state = replay(events);
    expect(state.parts.part_text?.type).toBe('text');
    if (state.parts.part_text?.type === 'text') {
      expect(state.parts.part_text.text).toBe('hello');
    }
  });

  it('tracks tool state transitions', () => {
    const state = replay(events);
    const part = state.parts.part_tool;
    expect(part?.type).toBe('tool');
    if (part?.type === 'tool') {
      expect(part.state.status).toBe('completed');
    }
  });

  it('records step-finish usage on session summary', () => {
    const state = replay(events);
    const summary = selectSessionSummary(state, 'sess_test');
    expect(summary.todos).toHaveLength(1);
    expect(selectSessionStatus(state, 'sess_test')).toBe('idle');
  });

  it('handles permission lifecycle', () => {
    const state = replay(events);
    expect(selectPermissions(state)).toHaveLength(0);
  });

  it('is idempotent when replaying the same events', () => {
    const once = replay(events);
    let twice = createEmptyOpenCodeStore('pane-test');
    for (const event of [...events, ...events]) {
      twice = applyOpenCodeWireEvent(twice, event);
    }
    expect(twice.seenEventIds.size).toBe(events.length);
    expect(twice.parts.part_text).toEqual(once.parts.part_text);
  });
});

describe('OpenCode part text streaming', () => {
  const base = createEmptyOpenCodeStore('pane-test');
  const sessionId = 'sess_ok';
  const messageId = 'msg_ok';
  const partId = 'part_ok';

  function wire(id: string, type: string, properties: Record<string, unknown>) {
    return { id, type, properties } as OpenCodeWireEvent;
  }

  it('updated then duplicate delta does not double text (Blue)', () => {
    let state = applyOpenCodeWireEvent(
      base,
      wire('m1', 'message.updated', {
        info: { id: messageId, sessionID: sessionId, role: 'assistant' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('u1', 'message.part.updated', {
        messageID: messageId,
        part: { id: partId, messageID: messageId, type: 'text', text: 'Blue' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('d1', 'message.part.delta', {
        messageID: messageId,
        partID: partId,
        field: 'text',
        delta: 'Blue',
      }),
    );
    expect(assembleMessageText(state, messageId)).toBe('Blue');
  });

  it('updated then duplicate delta does not double text (ok)', () => {
    let state = applyOpenCodeWireEvent(
      base,
      wire('m1', 'message.updated', {
        info: { id: messageId, sessionID: sessionId, role: 'assistant' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('u1', 'message.part.updated', {
        messageID: messageId,
        part: { id: partId, messageID: messageId, type: 'text', text: 'ok' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('d1', 'message.part.delta', {
        messageID: messageId,
        partID: partId,
        field: 'text',
        delta: 'ok',
      }),
    );
    expect(assembleMessageText(state, messageId)).toBe('ok');
  });

  it('appends a new token after authoritative updated text', () => {
    let state = applyOpenCodeWireEvent(
      base,
      wire('m1', 'message.updated', {
        info: { id: messageId, sessionID: sessionId, role: 'assistant' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('u1', 'message.part.updated', {
        messageID: messageId,
        part: { id: partId, messageID: messageId, type: 'text', text: 'Blue' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('d1', 'message.part.delta', {
        messageID: messageId,
        partID: partId,
        field: 'text',
        delta: '!',
      }),
    );
    expect(assembleMessageText(state, messageId)).toBe('Blue!');
  });

  it('delta then authoritative updated yields single text', () => {
    let state = applyOpenCodeWireEvent(
      base,
      wire('m1', 'message.updated', {
        info: { id: messageId, sessionID: sessionId, role: 'assistant' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('d1', 'message.part.delta', {
        messageID: messageId,
        partID: partId,
        field: 'text',
        delta: 'ok',
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('u1', 'message.part.updated', {
        messageID: messageId,
        part: { id: partId, messageID: messageId, type: 'text', text: 'ok' },
      }),
    );
    expect(assembleMessageText(state, messageId)).toBe('ok');
  });

  it('updated empty, delta, then updated full yields single text', () => {
    let state = applyOpenCodeWireEvent(
      base,
      wire('m1', 'message.updated', {
        info: { id: messageId, sessionID: sessionId, role: 'assistant' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('u0', 'message.part.updated', {
        messageID: messageId,
        part: { id: partId, messageID: messageId, type: 'text', text: '' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('d1', 'message.part.delta', {
        messageID: messageId,
        partID: partId,
        field: 'text',
        delta: 'ok',
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('u1', 'message.part.updated', {
        messageID: messageId,
        part: { id: partId, messageID: messageId, type: 'text', text: 'ok' },
      }),
    );
    expect(assembleMessageText(state, messageId)).toBe('ok');
  });

  it('applies reasoning deltas then authoritative updated', () => {
    const reasoningId = 'part_r';
    let state = applyOpenCodeWireEvent(
      base,
      wire('m1', 'message.updated', {
        info: { id: messageId, sessionID: sessionId, role: 'assistant' },
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('d1', 'message.part.delta', {
        messageID: messageId,
        partID: reasoningId,
        field: 'text',
        delta: 'think',
      }),
    );
    state = applyOpenCodeWireEvent(
      state,
      wire('u1', 'message.part.updated', {
        messageID: messageId,
        part: { id: reasoningId, messageID: messageId, type: 'reasoning', text: 'think' },
      }),
    );
    const part = state.parts[reasoningId];
    expect(part?.type).toBe('reasoning');
    if (part?.type === 'reasoning') {
      expect(part.text).toBe('think');
    }
  });
});

describe('OpenCode session status', () => {
  it('parses nested session.status.type busy', () => {
    let state = createEmptyOpenCodeStore('pane-test');
    state = applyOpenCodeWireEvent(state, {
      id: 's1',
      type: 'session.status',
      properties: {
        sessionID: 'sess_busy',
        status: { type: 'busy' },
      },
    } as OpenCodeWireEvent);
    expect(selectSessionStatus(state, 'sess_busy')).toBe('busy');
  });

  it('marks optimistic busy until idle wire event', () => {
    let state = markOptimisticBusy(createEmptyOpenCodeStore('pane-test'), 'sess_send');
    expect(selectSessionStatus(state, 'sess_send')).toBe('busy');
    state = applyOpenCodeWireEvent(state, {
      id: 'idle1',
      type: 'session.idle',
      properties: { sessionID: 'sess_send' },
    } as OpenCodeWireEvent);
    expect(selectSessionStatus(state, 'sess_send')).toBe('idle');
    expect(state.optimisticBusy.sess_send).toBeUndefined();
  });

  it('seeds idle for sessions missing from status snapshot', () => {
    let state = createEmptyOpenCodeStore('pane-test');
    state = applyOpenCodeWireEvent(state, {
      id: 'c1',
      type: 'session.created',
      properties: {
        session: {
          id: 'sess_a',
          slug: 'a',
          projectID: 'p',
          directory: '/tmp',
          title: 'A',
          version: '1',
          time: { created: 1, updated: 1 },
        },
      },
    } as OpenCodeWireEvent);
    state = applyOpenCodeWireEvent(state, {
      id: 'b1',
      type: 'session.status',
      properties: { sessionID: 'sess_b', status: { type: 'busy' } },
    } as OpenCodeWireEvent);
    state = applySessionStatusSnapshot(state, { sess_b: { type: 'busy' } });
    expect(selectSessionStatus(state, 'sess_a')).toBe('idle');
    expect(selectSessionStatus(state, 'sess_b')).toBe('busy');
  });
});

describe('OpenCode store live turn replay', () => {
  const liveEvents = loadFixture('live-turn.json');
  const sessionId = fixtureSessionId(liveEvents);

  it('replays captured server turn faithfully', () => {
    expect(sessionId.length).toBeGreaterThan(0);
    const state = replay(liveEvents);
    const messages = selectMessages(state, sessionId);
    expect(messages.some((m) => m.role === 'user')).toBe(true);
    expect(messages.some((m) => m.role === 'assistant')).toBe(true);

    const assistantWithText = messages
      .filter((m) => m.role === 'assistant')
      .find((m) => assembleMessageText(state, m.id).includes('hello'));
    expect(assistantWithText).toBeDefined();
    const finalText = finalTextPartForMessage(state, assistantWithText!.id);
    expect(finalText).toBeDefined();
    expect(assembleMessageText(state, assistantWithText!.id)).toContain(finalText!.text);

    const toolPart = Object.values(state.parts).find((p) => p.type === 'tool');
    expect(toolPart?.type).toBe('tool');
    if (toolPart?.type === 'tool') {
      expect(toolPart.state.status).toBe('completed');
    }

    const summary = selectSessionSummary(state, sessionId);
    expect(summary.tokens).toBeDefined();
    expect((summary.tokens ?? 0) > 0).toBe(true);
    expect(summary.costUsd).toBeDefined();
    expect((summary.costUsd ?? 0) > 0).toBe(true);

    expect(selectSessionStatus(state, sessionId)).toBe('idle');
  });
});
