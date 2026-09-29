import { describe, expect, it } from 'vitest';
import { createEmptyOpenCodeStore } from '../opencode/store.js';
import { displayOpenCodeSessionTitle } from './session-display-title';

describe('displayOpenCodeSessionTitle', () => {
  it('replaces loomria uuid placeholder with first user preview', () => {
    const state = createEmptyOpenCodeStore('pane');
    const sessionId = 'sess_1';
    state.sessions[sessionId] = {
      id: sessionId,
      slug: 'sess',
      projectID: 'proj',
      directory: '/tmp',
      version: '1',
      title: 'loomria 550e8400-e29b-41d4-a716-446655440000',
      time: { created: Date.now(), updated: Date.now() },
    };
    state.messagesBySession[sessionId] = ['msg_u'];
    state.messages.msg_u = {
      id: 'msg_u',
      sessionID: sessionId,
      role: 'user',
      agent: 'build',
      model: { providerID: 'opencode-go', modelID: 'mimo' },
      time: { created: Date.now() },
    };
    state.partsByMessage.msg_u = ['part_u'];
    state.parts.part_u = {
      id: 'part_u',
      sessionID: sessionId,
      messageID: 'msg_u',
      type: 'text',
      text: 'Fix the login bug',
    };

    expect(displayOpenCodeSessionTitle(state, sessionId, state.sessions[sessionId].title)).toBe(
      'Fix the login bug',
    );
  });
});
