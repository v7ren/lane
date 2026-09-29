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
