import { describe, expect, it } from 'vitest';
import type { ShellSession } from '../shell-data';
import { groupSessionsByWorkspace, pathBasename } from './workspace-groups';

describe('workspace-groups', () => {
  it('uses parent/basename when basenames collide', () => {
    const webA = 'C:\\Users\\demo\\loomria\\packages\\web';
    const webB = 'C:\\Users\\demo\\loomria\\packages\\api\\web';
    const rows: ShellSession[] = [
      {
        id: '1',
        paneId: 'p',
        title: 'Web task',
        agentLabel: 'Build',
        status: 'idle',
        updatedAt: 1,
        unread: false,
        workspaceDirectory: webA,
      },
      {
        id: '2',
        paneId: 'p',
        title: 'Nested web task',
        agentLabel: 'Build',
        status: 'idle',
        updatedAt: 2,
        unread: false,
        workspaceDirectory: webB,
      },
    ];
    const groups = groupSessionsByWorkspace(rows);
    expect(groups).toHaveLength(2);
    const labels = groups.map((g) => g.label).sort();
    expect(labels).toEqual(['api/web', 'packages/web']);
    expect(pathBasename(webA)).toBe('web');
  });
});
