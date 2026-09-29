import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { OpenCodeWireEvent } from '@loomria/shared/opencode';

import { selectMessages } from './selectors.js';
import { applyOpenCodeWireEvent, createEmptyOpenCodeStore } from './store.js';
import { fromOpenCode } from '../transcript/from-opencode.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function replay(events: OpenCodeWireEvent[]) {
  let state = createEmptyOpenCodeStore('pane-test');
  for (const event of events) {
    state = applyOpenCodeWireEvent(state, event);
  }
  return state;
}

describe('OpenCode ordering', () => {
  it('orders messages by time.created even when user update arrives late', () => {
    const events = JSON.parse(
      readFileSync(path.join(fixtureDir, 'out-of-order-turn.json'), 'utf8'),
    ).events as OpenCodeWireEvent[];
    const state = replay(events);
    const messages = selectMessages(state, 'sess_order');
    expect(messages.map((m) => m.id)).toEqual(['msg_user', 'msg_asst_1', 'msg_asst_2']);
  });

  it('keeps parts in event order when tool times would sort text first', () => {
    const events = JSON.parse(
      readFileSync(path.join(fixtureDir, 'out-of-order-turn.json'), 'utf8'),
    ).events as OpenCodeWireEvent[];
    const state = replay(events);
    const vm = fromOpenCode(state, 'sess_order');
    const assistant2 = vm.turns.find((t) => t.id === 'msg_asst_2');
    const kinds = assistant2?.items.map((i) => i.kind);
    const toolIdx = kinds?.indexOf('tool_call') ?? -1;
    const textIdx = kinds?.indexOf('assistant_text') ?? -1;
    expect(toolIdx).toBeGreaterThan(-1);
    expect(textIdx).toBeGreaterThan(toolIdx);
  });
});
