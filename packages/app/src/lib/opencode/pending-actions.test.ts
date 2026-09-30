import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { OpenCodeRequestArgs } from './client.js';
import {
  buildPermissionReplyBody,
  buildQuestionReplyBody,
  mapApprovalDecisionToPermissionReply,
  openCodePermissionReplyArgs,
  openCodeQuestionRejectArgs,
  openCodeQuestionReplyArgs,
} from './pending-requests.js';
import {
  applyOpenCodeWireEvent,
  createEmptyOpenCodeStore,
  createOpenCodePendingActions,
  type OpenCodeStoreState,
} from './store.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');

describe('OpenCode pending HTTP shapes', () => {
  it('buildQuestionReplyBody uses answers array', () => {
    expect(buildQuestionReplyBody([['Red']])).toEqual({ answers: [['Red']] });
  });

  it('openCodeQuestionReplyArgs targets reply path', () => {
    expect(openCodeQuestionReplyArgs('pane-1', 'que_1', [['Blue']])).toEqual({
      pane_id: 'pane-1',
      method: 'POST',
      path: '/question/que_1/reply',
      body: { answers: [['Blue']] },
    });
  });

  it('openCodeQuestionRejectArgs has no body', () => {
    expect(openCodeQuestionRejectArgs('pane-1', 'que_1')).toEqual({
      pane_id: 'pane-1',
      method: 'POST',
      path: '/question/que_1/reject',
    });
  });

  it('maps permission dock decisions to wire replies', () => {
    expect(mapApprovalDecisionToPermissionReply('allow_once')).toBe('once');
    expect(mapApprovalDecisionToPermissionReply('allow_always')).toBe('always');
    expect(mapApprovalDecisionToPermissionReply('deny')).toBe('reject');
  });

  it('openCodePermissionReplyArgs sends mapped reply', () => {
    expect(openCodePermissionReplyArgs('pane-1', 'perm_1', 'reject')).toEqual({
      pane_id: 'pane-1',
      method: 'POST',
      path: '/permission/perm_1/reply',
      body: buildPermissionReplyBody('reject'),
    });
  });
});

describe('createOpenCodePendingActions', () => {
  const asked = JSON.parse(
    readFileSync(path.join(fixtureDir, 'question-asked.json'), 'utf8'),
  ) as { properties: Record<string, unknown> };

  function stateWithQuestion(): OpenCodeStoreState {
    return applyOpenCodeWireEvent(createEmptyOpenCodeStore('pane-1'), {
      id: 'evt_q',
      type: 'question.asked',
      properties: asked.properties,
    } as never);
  }

  it('replyQuestion calls POST reply with answers body', async () => {
    let state = stateWithQuestion();
    const calls: OpenCodeRequestArgs[] = [];
    const actions = createOpenCodePendingActions({
      paneId: 'pane-1',
      getState: () => state,
      setState: (updater) => {
        state = updater(state);
      },
      request: async (args) => {
        calls.push(args);
        return null;
      },
    });

    await actions.replyQuestion('que_demo_001', [['Red']]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(openCodeQuestionReplyArgs('pane-1', 'que_demo_001', [['Red']]));
    expect(state.questions.que_demo_001?.submitting).toBe(true);
  });

  it('replyQuestion error keeps pending item and sets lastRequestError', async () => {
    let state = stateWithQuestion();
    const actions = createOpenCodePendingActions({
      paneId: 'pane-1',
      getState: () => state,
      setState: (updater) => {
        state = updater(state);
      },
      request: async () => {
        throw new Error('HTTP 500');
      },
    });

    await actions.replyQuestion('que_demo_001', [['Red']]);
    expect(state.questions.que_demo_001).toBeDefined();
    expect(state.questions.que_demo_001?.submitting).toBe(false);
    expect(state.lastRequestError).toBe('HTTP 500');
  });

  it('rejectQuestion calls POST reject without body', async () => {
    let state = stateWithQuestion();
    const calls: OpenCodeRequestArgs[] = [];
    const actions = createOpenCodePendingActions({
      paneId: 'pane-1',
      getState: () => state,
      setState: (updater) => {
        state = updater(state);
      },
      request: async (args) => {
        calls.push(args);
        return null;
      },
    });

    await actions.rejectQuestion('que_demo_001');
    expect(calls[0]).toEqual(openCodeQuestionRejectArgs('pane-1', 'que_demo_001'));
  });

  it('replyPermission sends once/always/reject on wire', async () => {
    const permAsked = JSON.parse(
      readFileSync(path.join(fixtureDir, 'permission-asked.json'), 'utf8'),
    ) as { properties: Record<string, unknown> };
    let state = applyOpenCodeWireEvent(createEmptyOpenCodeStore('pane-1'), {
      id: 'evt_p',
      type: 'permission.asked',
      properties: permAsked.properties,
    } as never);
    const permId = Object.keys(state.permissions)[0]!;
    const calls: OpenCodeRequestArgs[] = [];
    const actions = createOpenCodePendingActions({
      paneId: 'pane-1',
      getState: () => state,
      setState: (updater) => {
        state = updater(state);
      },
      request: async (args) => {
        calls.push(args);
        return null;
      },
    });

    await actions.replyPermission(permId, 'once');
    expect(calls[0]?.body).toEqual({ reply: 'once' });
    expect(state.permissions[permId]?.submitting).toBe(true);
  });
});
