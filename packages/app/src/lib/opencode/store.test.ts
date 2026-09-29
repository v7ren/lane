import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { OpenCodeWireEvent } from '@loomria/shared/opencode';

import { selectMessages, selectPermissions, selectSessionSummary, selectSessionStatus } from './selectors.js';
import { applyOpenCodeWireEvent, createEmptyOpenCodeStore } from './store.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function loadFixture(name: string): OpenCodeWireEvent[] {
  const raw = JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8')) as {
    events: OpenCodeWireEvent[];
  };
  return raw.events;
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
