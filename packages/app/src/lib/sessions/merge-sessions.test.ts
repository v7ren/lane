import { describe, expect, it } from 'vitest';
import { createEmptyOpenCodeStore } from '../opencode/store.js';
import { buildOpenCodeShellSessions, mergeShellSessionLists, nestChildSessions } from './merge-sessions';
import type { ShellSession } from '../shell-data';

describe('merge OpenCode and pane sessions', () => {
  it('builds OpenCode rows with session ids', () => {
    let state = createEmptyOpenCodeStore('pane-oc');
    state = {
      ...state,
      sessionOrder: ['sess_a'],
      sessions: {
        sess_a: {
          id: 'sess_a',
          slug: 'a',
          projectID: 'p',
          directory: '/tmp',
          title: 'Test session',
          version: '1',
          time: { created: 1, updated: 2 },
        },
      },
    };
    const rows = buildOpenCodeShellSessions({
      paneId: 'pane-oc',
      state,
      agentCatalog: { agents: [], report: { errors: [] } },
      selectedPaneId: null,
      selectedSessionId: null,
      readAtMs: {},
    });
    expect(rows[0]?.sessionId).toBe('sess_a');
    expect(rows[0]?.id).toBe('sess_a');
  });

  it('nests child sessions under parent', () => {
    const flat: ShellSession[] = [
      {
        id: 'parent',
        paneId: 'p',
        sessionId: 'parent',
        title: 'Parent',
        agentLabel: 'A',
        status: 'idle',
        updatedAt: 1,
        unread: false,
      },
      {
        id: 'child',
        paneId: 'p',
        sessionId: 'child',
        parentSessionId: 'parent',
        title: 'Child',
        agentLabel: 'A',
        status: 'idle',
        updatedAt: 0,
        unread: false,
      },
    ];
    const nested = nestChildSessions(flat);
    expect(nested).toHaveLength(2);
    expect(nested[1]?.depth).toBe(1);
  });

  it('mergeShellSessionLists combines sources', () => {
    const merged = mergeShellSessionLists(
      [
        {
          id: 'oc1',
          paneId: 'p1',
          sessionId: 'oc1',
          title: 'OC',
          agentLabel: 'OpenCode',
          status: 'idle',
          updatedAt: 1,
          unread: false,
        },
      ],
      [
        {
          id: 'pane-codex',
          paneId: 'pane-codex',
          title: 'Codex',
          agentLabel: 'Codex',
          status: 'working',
          updatedAt: 2,
          unread: false,
        },
      ],
    );
    expect(merged.some((s) => s.sessionId === 'oc1')).toBe(true);
    expect(merged.some((s) => s.paneId === 'pane-codex')).toBe(true);
  });

  it('dedupes a session listed by two panes, preferring the selected pane', () => {
    const row = (paneId: string) => ({
      id: 'ses1',
      paneId,
      sessionId: 'ses1',
      title: 'Shared',
      agentLabel: 'OpenCode',
      status: 'idle' as const,
      updatedAt: 1,
      unread: false,
    });
    expect(mergeShellSessionLists([row('a'), row('b')], [])).toHaveLength(1);
    expect(mergeShellSessionLists([row('a'), row('b')], [], 'b')[0]?.paneId).toBe('b');
  });
});
