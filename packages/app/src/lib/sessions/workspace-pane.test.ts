import { describe, expect, it } from 'vitest';
import { findOpenCodePaneForProject } from './workspace-pane';

describe('findOpenCodePaneForProject', () => {
  it('matches cwd with different path separators', () => {
    const panes = [
      {
        info: {
          id: 'pane-1',
          agent_type: 'opencode_native',
          cwd: 'C:\\Users\\dev\\repo',
          pid: 1,
          status: 'running' as const,
          created_at: 0,
          last_output_at: null,
          cols: 80,
          rows: 24,
        },
        status: 'running' as const,
      },
    ];
    const found = findOpenCodePaneForProject(panes, 'C:/Users/dev/repo');
    expect(found?.info.id).toBe('pane-1');
  });
});
