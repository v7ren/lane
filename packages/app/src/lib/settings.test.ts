import type { Settings } from '@loomria/shared';
import { describe, expect, it } from 'vitest';
import { mergeLoadedSettings } from './settings';

describe('settings persistence helpers', () => {
  it('mergeLoadedSettings keeps project_path from disk', () => {
    const merged = mergeLoadedSettings({
      project_path: 'C:\\Users\\dev\\loomria-p3',
    } as Settings);
    expect(merged.project_path).toBe('C:\\Users\\dev\\loomria-p3');
  });
});
