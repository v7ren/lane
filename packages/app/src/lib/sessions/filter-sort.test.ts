import { describe, expect, it } from 'vitest';
import { filterSessions, sortShellSessions } from './filter-sort';
import type { ShellSession } from '../shell-data';

const row = (partial: Partial<ShellSession> & Pick<ShellSession, 'id' | 'paneId' | 'title'>): ShellSession => ({
  agentLabel: 'Agent',
  status: 'idle',
  updatedAt: 0,
  unread: false,
  ...partial,
});

describe('filterSessions', () => {
  it('matches title and last message', () => {
    const rows = [
      row({ id: '1', paneId: 'p', title: 'Alpha', lastMessagePreview: 'hello world' }),
      row({ id: '2', paneId: 'p', title: 'Beta', lastMessagePreview: 'other' }),
    ];
    expect(filterSessions(rows, 'hello')).toHaveLength(1);
    expect(filterSessions(rows, 'beta')).toHaveLength(1);
  });
});

describe('sortShellSessions', () => {
  it('puts needs_approval first in attention mode', () => {
    const rows = [
      row({ id: '1', paneId: 'p', title: 'Idle', status: 'idle', updatedAt: 100 }),
      row({ id: '2', paneId: 'p', title: 'Approve', status: 'needs_approval', updatedAt: 1 }),
    ];
    const sorted = sortShellSessions(rows, 'attention');
    expect(sorted[0]?.title).toBe('Approve');
  });
});
