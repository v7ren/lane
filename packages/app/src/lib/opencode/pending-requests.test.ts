import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { OpenCodeWireEvent, PermissionAsked, QuestionRequest } from '@loomria/shared/opencode';

import {
  applyPendingWireEvent,
  clearPendingForSession,
  hydratePending,
} from './pending-requests.js';
import { applyOpenCodeWireEvent, createEmptyOpenCodeStore } from './store.js';
import { getPendingForSession, selectPermissions, selectQuestions } from './selectors.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

function loadWireFixture(name: string): OpenCodeWireEvent {
  return JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8')) as OpenCodeWireEvent;
}

function loadQuestionList(): QuestionRequest[] {
  return JSON.parse(readFileSync(path.join(fixtureDir, 'question-list.json'), 'utf8')) as QuestionRequest[];
}

function emptyMaps() {
  return { questions: {}, permissions: {} };
}

function replayWire(...events: OpenCodeWireEvent[]) {
  let state = createEmptyOpenCodeStore('pane-test');
  for (const event of events) {
    state = applyOpenCodeWireEvent(state, event);
  }
  return state;
}

describe('pending-requests wire lifecycle', () => {
  it('question asked then replied clears questions', () => {
    const asked = loadWireFixture('question-asked.json');
    const replied: OpenCodeWireEvent = {
      id: 'evt_reply',
      type: 'question.replied',
      properties: {
        sessionID: 'ses_demo_001',
        requestID: 'que_demo_001',
        answers: [['Red']],
      },
    };
    const state = replayWire(asked, replied);
    expect(selectQuestions(state)).toHaveLength(0);
  });

  it('permission asked then replied clears permissions', () => {
    const asked = loadWireFixture('permission-asked.json');
    const replied = loadWireFixture('permission-replied.json');
    const state = replayWire(asked, replied);
    expect(selectPermissions(state)).toHaveLength(0);
  });

  it('question rejected clears pending question', () => {
    const asked = loadWireFixture('question-asked.json');
    const rejected: OpenCodeWireEvent = {
      id: 'evt_reject',
      type: 'question.rejected',
      properties: {
        sessionID: 'ses_demo_001',
        requestID: 'que_demo_001',
      },
    };
    const state = replayWire(asked, rejected);
    expect(selectQuestions(state)).toHaveLength(0);
  });

  it('flat live question-asked upserts into store', () => {
    const asked = loadWireFixture('question-asked.json');
    const state = replayWire(asked);
    expect(selectQuestions(state)).toHaveLength(1);
    expect(selectQuestions(state)[0]?.id).toBe('que_demo_001');
    expect(state.questions.que_demo_001?.receivedAt).toBeTypeOf('number');
  });

  it('duplicate asked for same id does not create two entries', () => {
    const asked = loadWireFixture('question-asked.json');
    let maps = emptyMaps();
    maps = applyPendingWireEvent(maps, 'question.asked', asked.properties);
    maps = applyPendingWireEvent(maps, 'question.asked', asked.properties);
    expect(Object.keys(maps.questions)).toHaveLength(1);
  });

  it('hydratePending replaces maps from list', () => {
    const list = loadQuestionList();
    const hydrated = hydratePending(
      {
        questions: {
          stale: {
            id: 'stale',
            sessionID: 'sess_x',
            questions: [],
            receivedAt: 1,
          },
        },
        permissions: {},
      },
      { questions: list, permissions: [] },
      99,
    );
    expect(Object.keys(hydrated.questions)).toEqual(['que_demo_001']);
    expect(hydrated.questions.que_demo_001?.receivedAt).toBe(99);
    expect(hydrated.questions.stale).toBeUndefined();
  });

  it('session.deleted drops pending for that session', () => {
    const asked = loadWireFixture('question-asked.json');
    let state = replayWire(asked);
    state = applyOpenCodeWireEvent(state, {
      id: 'del1',
      type: 'session.deleted',
      properties: { sessionID: 'ses_demo_001' },
    } as OpenCodeWireEvent);
    expect(selectQuestions(state)).toHaveLength(0);
  });

  it('nested synthetic permission and question shapes still work', () => {
    const events = JSON.parse(
      readFileSync(path.join(fixtureDir, 'synthetic-events.json'), 'utf8'),
    ) as { events: OpenCodeWireEvent[] };
    const permAsked = events.events.find((e) => e.id === 'e-perm')!;
    const permReplied = events.events.find((e) => e.id === 'e-perm-reply')!;
    const questionAsked = events.events.find((e) => e.id === 'e-question')!;
    const questionReplied = events.events.find((e) => e.id === 'e-question-reply')!;

    let state = createEmptyOpenCodeStore('pane-test');
    state = applyOpenCodeWireEvent(state, permAsked);
    expect(selectPermissions(state)).toHaveLength(1);
    state = applyOpenCodeWireEvent(state, permReplied);
    expect(selectPermissions(state)).toHaveLength(0);

    state = applyOpenCodeWireEvent(state, questionAsked);
    expect(selectQuestions(state)).toHaveLength(1);
    state = applyOpenCodeWireEvent(state, questionReplied);
    expect(selectQuestions(state)).toHaveLength(0);
  });

  it('getPendingForSession filters by sessionID', () => {
    const asked = loadWireFixture('question-asked.json');
    const state = replayWire(asked);
    const pending = getPendingForSession(state, 'ses_demo_001');
    expect(pending.questions).toHaveLength(1);
    expect(getPendingForSession(state, 'other')).toEqual({ questions: [], permissions: [] });
  });
});
