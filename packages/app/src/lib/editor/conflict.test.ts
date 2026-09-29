import { describe, expect, it } from 'vitest';
import { keepMine, onDiskChange, openCompare, reloadFromDisk } from './conflict';

describe('disk conflict state machine', () => {
  it('reloads silently without unsaved edits', () => {
    const result = onDiskChange(
      { phase: 'idle', diskContent: null, diskMtimeMs: null },
      false,
      'disk',
      2,
      'editor',
    );
    expect(result.reload).toBe(true);
    expect(result.state.phase).toBe('idle');
  });

  it('prompts when disk diverges with dirty buffer', () => {
    const result = onDiskChange(
      { phase: 'idle', diskContent: null, diskMtimeMs: null },
      true,
      'disk',
      2,
      'editor',
    );
    expect(result.reload).toBe(false);
    expect(result.state.phase).toBe('prompt');
  });

  it('supports compare and keep mine', () => {
    const prompted = onDiskChange(
      { phase: 'idle', diskContent: null, diskMtimeMs: null },
      true,
      'disk',
      2,
      'editor',
    ).state;
    expect(openCompare(prompted).phase).toBe('compare');
    expect(keepMine(prompted).phase).toBe('idle');
    expect(reloadFromDisk().phase).toBe('idle');
  });
});
