import type { Settings } from '@loomria/shared';
import { describe, expect, it } from 'vitest';
import { coerceStoredSettings, mergeLoadedSettings } from './settings';

describe('settings persistence helpers', () => {
  it('mergeLoadedSettings keeps project_path from disk', () => {
    const merged = mergeLoadedSettings({
      project_path: 'C:\\Users\\dev\\loomria-p3',
    } as Settings);
    expect(merged.project_path).toBe('C:\\Users\\dev\\loomria-p3');
  });

  it('coerceStoredSettings repairs array-spread corruption and prefers top-level project_path', () => {
    const coerced = coerceStoredSettings({
      0: { project_path: 'C:\\old', theme: 'dark' },
      1: true,
      project_path: 'C:\\new',
    });
    expect(coerced?.project_path).toBe('C:\\new');
  });
});
