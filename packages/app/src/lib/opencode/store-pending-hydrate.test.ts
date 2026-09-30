import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { OpenCodeWireEvent, QuestionRequest } from '@loomria/shared/opencode';

import { getPendingForSession } from './selectors.js';
import {
  applyOpenCodeEnvelope,
  applyOpenCodeWireEvent,
  createEmptyOpenCodeStore,
  hydratePendingOnState,
} from './store.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function loadWireFixture(name: string): OpenCodeWireEvent {
  return JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8')) as OpenCodeWireEvent;
}

function loadQuestionList(): QuestionRequest[] {
  return JSON.parse(readFileSync(path.join(fixtureDir, 'question-list.json'), 'utf8')) as QuestionRequest[];
}

function questionAskedForSession(requestId: string, sessionID: string): OpenCodeWireEvent {
  const asked = loadWireFixture('question-asked.json');
  const props = asked.properties as Record<string, unknown>;
  return {
    ...asked,
    id: `evt_question_${requestId}`,
    properties: {
      ...props,
      id: requestId,
      sessionID,
    },
  };
}

describe('pending hydrate on store state', () => {
  it('empty store + LIST with one question exposes dock data for that session', () => {
    let state = createEmptyOpenCodeStore('pane-test');
    const list = loadQuestionList();
    state = hydratePendingOnState(state, { questions: list, permissions: [] });

    const pending = getPendingForSession(state, 'ses_demo_001');
    expect(pending.questions).toHaveLength(1);
    expect(pending.questions[0]?.id).toBe('que_demo_001');
    expect(pending.questions[0]?.questions[0]?.header).toBe('Color choice');
    expect(pending.questions[0]?.questions[0]?.question).toBe('Pick a color:');

    expect(getPendingForSession(state, 'ses_other_empty').questions).toHaveLength(0);
  });

  it('reconnect hydrate keeps pending question without duplicating', () => {
    const asked = loadWireFixture('question-asked.json');
    let state = createEmptyOpenCodeStore('pane-test');
    state = applyOpenCodeWireEvent(state, asked);
    expect(getPendingForSession(state, 'ses_demo_001').questions).toHaveLength(1);

    state = hydratePendingOnState(state, {
      questions: loadQuestionList(),
      permissions: [],
    });

    const pending = getPendingForSession(state, 'ses_demo_001');
    expect(pending.questions).toHaveLength(1);
    expect(pending.questions[0]?.id).toBe('que_demo_001');
    expect(Object.keys(state.questions)).toEqual(['que_demo_001']);
  });

  it('session switch queries keep each session pending in the store', () => {
    const sessionA = 'ses_pending_a';
    const sessionB = 'ses_pending_b';
    let state = createEmptyOpenCodeStore('pane-test');
    state = applyOpenCodeWireEvent(state, questionAskedForSession('que_sess_a', sessionA));
    state = applyOpenCodeWireEvent(state, questionAskedForSession('que_sess_b', sessionB));

    const firstA = getPendingForSession(state, sessionA);
    expect(firstA.questions).toHaveLength(1);
    expect(firstA.questions[0]?.id).toBe('que_sess_a');

    const firstB = getPendingForSession(state, sessionB);
    expect(firstB.questions).toHaveLength(1);
    expect(firstB.questions[0]?.id).toBe('que_sess_b');

    const secondA = getPendingForSession(state, sessionA);
    expect(secondA.questions).toHaveLength(1);
    expect(secondA.questions[0]?.id).toBe('que_sess_a');
  });

  it('loomria.opencode.connected envelope does not clear pending questions', () => {
    const asked = loadWireFixture('question-asked.json');
    let state = createEmptyOpenCodeStore('pane-test');
    state = applyOpenCodeWireEvent(state, asked);
    expect(getPendingForSession(state, 'ses_demo_001').questions).toHaveLength(1);

    state = applyOpenCodeEnvelope(state, {
      pane_id: 'pane-test',
      server_id: 'srv_demo',
      event: {
        id: 'evt_connected_001',
        type: 'loomria.opencode.connected',
        properties: {},
      },
    });

    expect(state.connectionStatus).toBe('connected');
    const pending = getPendingForSession(state, 'ses_demo_001');
    expect(pending.questions).toHaveLength(1);
    expect(pending.questions[0]?.id).toBe('que_demo_001');
  });
});
