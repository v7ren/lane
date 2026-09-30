import { describe, expect, it } from 'vitest';

import { createEmptyOpenCodeStore } from './store.js';
import { getPendingForSession } from './selectors.js';
import {
  deriveOpenCodeDisplayStatus,
  formatOpenCodeSessionDisplayLabel,
} from './session-status.js';
import { openCodeSessionDisplayStatus } from '../sessions/merge-sessions.js';

describe('deriveOpenCodeDisplayStatus', () => {
  const pendingQuestion = { questions: [{}], permissions: [] as unknown[] };
  const noPending = { questions: [] as unknown[], permissions: [] as unknown[] };

  it('returns waiting when busy with pending question or permission', () => {
    expect(deriveOpenCodeDisplayStatus('busy', pendingQuestion)).toBe('waiting');
    expect(deriveOpenCodeDisplayStatus('busy', { questions: [], permissions: [{}] })).toBe(
      'waiting',
    );
  });

  it('returns working when busy without pending', () => {
    expect(deriveOpenCodeDisplayStatus('busy', noPending)).toBe('working');
  });

  it('does not return waiting when idle with pending', () => {
    expect(deriveOpenCodeDisplayStatus('idle', pendingQuestion)).toBe('needs_approval');
    expect(deriveOpenCodeDisplayStatus('idle', pendingQuestion)).not.toBe('waiting');
  });
});

describe('openCodeSessionDisplayStatus', () => {
  it('labels busy pending sessions as Waiting for input', () => {
    let state = createEmptyOpenCodeStore('pane-1');
    state = {
      ...state,
      sessionOrder: ['sess_a'],
      sessions: {
        sess_a: {
          id: 'sess_a',
          slug: 'a',
          projectID: 'p',
          directory: '/tmp',
          title: 'Test',
          version: '1',
          time: { created: 1, updated: 2 },
        },
      },
      sessionStatus: { sess_a: 'busy' },
      questions: {
        q1: {
          id: 'q1',
          sessionID: 'sess_a',
          questions: [],
          receivedAt: 1,
        },
      },
    };
    expect(getPendingForSession(state, 'sess_a').questions).toHaveLength(1);
    const display = openCodeSessionDisplayStatus(state, 'sess_a');
    expect(display.status).toBe('waiting');
    expect(display.label).toBe('Waiting for input');
    expect(formatOpenCodeSessionDisplayLabel('waiting', 'busy')).toBe('Waiting for input');
  });
});
