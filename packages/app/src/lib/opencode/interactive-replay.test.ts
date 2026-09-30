import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { OpenCodeWireEvent } from '@loomria/shared/opencode';

import { openCodeSessionDisplayStatus } from '../sessions/merge-sessions.js';
import { fromOpenCode } from '../transcript/from-opencode.js';
import { deriveOpenCodeDisplayStatus } from './session-status.js';
import { getPendingForSession, selectSessionStatus } from './selectors.js';
import { applyOpenCodeWireEvent, createEmptyOpenCodeStore } from './store.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

type InteractiveReplayFixture = {
  events: OpenCodeWireEvent[];
  permissionEvents: OpenCodeWireEvent[];
};

function loadInteractiveReplayFixture(): InteractiveReplayFixture {
  return JSON.parse(
    readFileSync(path.join(fixtureDir, 'interactive-replay.json'), 'utf8'),
  ) as InteractiveReplayFixture;
}

const SESSION_ID = 'ses_replay_001';
const PERM_SESSION_ID = 'ses_replay_perm_001';

function pendingQuestionCount(
  state: ReturnType<typeof createEmptyOpenCodeStore>,
  sessionId: string,
): number {
  return getPendingForSession(state, sessionId).questions.length;
}

function pendingPermissionCount(
  state: ReturnType<typeof createEmptyOpenCodeStore>,
  sessionId: string,
): number {
  return getPendingForSession(state, sessionId).permissions.length;
}

function displayStatus(
  state: ReturnType<typeof createEmptyOpenCodeStore>,
  sessionId: string,
) {
  const pending = getPendingForSession(state, sessionId);
  const ocStatus = selectSessionStatus(state, sessionId);
  return {
    ocStatus,
    derived: deriveOpenCodeDisplayStatus(ocStatus, pending),
    openCode: openCodeSessionDisplayStatus(state, sessionId),
  };
}

describe('interactive replay — question asked to answered', () => {
  it('replays wire events step by step with status and pending assertions', () => {
    const { events } = loadInteractiveReplayFixture();
    let state = createEmptyOpenCodeStore('pane-replay');

    state = applyOpenCodeWireEvent(state, events[0]!);
    expect(pendingQuestionCount(state, SESSION_ID)).toBe(0);
    expect(selectSessionStatus(state, SESSION_ID)).toBe('busy');
    expect(displayStatus(state, SESSION_ID).derived).toBe('working');
    expect(displayStatus(state, SESSION_ID).openCode.status).not.toBe('waiting');

    state = applyOpenCodeWireEvent(state, events[1]!);
    expect(pendingQuestionCount(state, SESSION_ID)).toBe(1);
    expect(selectSessionStatus(state, SESSION_ID)).toBe('busy');
    expect(displayStatus(state, SESSION_ID).derived).toBe('waiting');
    expect(displayStatus(state, SESSION_ID).openCode.status).toBe('waiting');

    state = applyOpenCodeWireEvent(state, events[2]!);
    expect(pendingQuestionCount(state, SESSION_ID)).toBe(0);
    expect(selectSessionStatus(state, SESSION_ID)).toBe('busy');
    expect(displayStatus(state, SESSION_ID).derived).toBe('working');
    expect(displayStatus(state, SESSION_ID).openCode.status).not.toBe('waiting');

    state = applyOpenCodeWireEvent(state, events[3]!);
    state = applyOpenCodeWireEvent(state, events[4]!);
    const vm = fromOpenCode(state, SESSION_ID);
    const assistantText = vm.turns
      .flatMap((t) => t.items)
      .filter((i) => i.kind === 'assistant_text')
      .map((i) => (i.kind === 'assistant_text' ? i.markdown : ''))
      .join('\n');
    expect(assistantText.toLowerCase()).toContain('blue');

    state = applyOpenCodeWireEvent(state, events[5]!);
    expect(pendingQuestionCount(state, SESSION_ID)).toBe(0);
    expect(selectSessionStatus(state, SESSION_ID)).toBe('idle');
    expect(displayStatus(state, SESSION_ID).derived).toBe('idle');
    expect(displayStatus(state, SESSION_ID).openCode.status).toBe('idle');
  });
});

describe('interactive replay — permission asked to replied', () => {
  it('replays permission wire with pending and display waiting while busy', () => {
    const { permissionEvents } = loadInteractiveReplayFixture();
    let state = createEmptyOpenCodeStore('pane-replay-perm');

    state = applyOpenCodeWireEvent(state, permissionEvents[0]!);
    expect(pendingPermissionCount(state, PERM_SESSION_ID)).toBe(0);
    expect(selectSessionStatus(state, PERM_SESSION_ID)).toBe('busy');
    expect(displayStatus(state, PERM_SESSION_ID).derived).toBe('working');

    state = applyOpenCodeWireEvent(state, permissionEvents[1]!);
    expect(pendingPermissionCount(state, PERM_SESSION_ID)).toBe(1);
    expect(selectSessionStatus(state, PERM_SESSION_ID)).toBe('busy');
    expect(displayStatus(state, PERM_SESSION_ID).derived).toBe('waiting');
    expect(displayStatus(state, PERM_SESSION_ID).openCode.status).toBe('waiting');

    state = applyOpenCodeWireEvent(state, permissionEvents[2]!);
    expect(pendingPermissionCount(state, PERM_SESSION_ID)).toBe(0);
    expect(selectSessionStatus(state, PERM_SESSION_ID)).toBe('busy');
    expect(displayStatus(state, PERM_SESSION_ID).derived).toBe('working');

    state = applyOpenCodeWireEvent(state, permissionEvents[3]!);
    expect(pendingPermissionCount(state, PERM_SESSION_ID)).toBe(0);
    expect(selectSessionStatus(state, PERM_SESSION_ID)).toBe('idle');
    expect(displayStatus(state, PERM_SESSION_ID).derived).toBe('idle');
  });
});
