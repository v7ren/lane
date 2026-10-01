import { describe, expect, it } from 'vitest';
import { diffStat, lineDiffCounts } from './diff-stat';

describe('diffStat', () => {
  it('counts a Claude Edit after removing common lines', () => {
    const input = { file_path: 'a.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd' };
    expect(diffStat('edit', input)).toEqual({ added: 2, removed: 1 });
  });

  it('parses a JSON string input', () => {
    expect(diffStat('edit', JSON.stringify({ old_string: 'x', new_string: 'y\nz' }))).toEqual({
      added: 2,
      removed: 1,
    });
  });

  it('sums MultiEdit edits', () => {
    const input = {
      file_path: 'a.ts',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c\nd', new_string: 'c' },
      ],
    };
    expect(diffStat('multiedit', input)).toEqual({ added: 1, removed: 2 });
  });

  it('counts Write content lines as additions', () => {
    expect(diffStat('write', { file_path: 'a', content: 'one\ntwo\nthree\n' })).toEqual({
      added: 3,
      removed: 0,
    });
  });

  it('counts + and - lines of Codex fileChange diffs, ignoring headers', () => {
    const input = {
      changes: [
        { path: 'a', kind: 'update', diff: '--- a\n+++ a\n@@ -1 +1,2 @@\n-old\n+new\n+more' },
        { path: 'b', kind: 'add', diff: '+x' },
      ],
    };
    expect(diffStat('filechange', input)).toEqual({ added: 3, removed: 1 });
  });

  it('is undefined for non-edit tools and empty changes', () => {
    expect(diffStat('bash', 'ls')).toBeUndefined();
    expect(diffStat('edit', { old_string: 'a', new_string: 'a' })).toBeUndefined();
  });

  it('omits inaccurate stats for large reorders and propagates unknown MultiEdit counts', () => {
    const oldLines = Array.from({ length: 2001 }, (_, i) => `line-${i}`);
    const newLines = [...oldLines.slice(1), oldLines[0]!, 'added'];
    const oldText = oldLines.join('\n');
    const newText = newLines.join('\n');

    expect(lineDiffCounts(oldText, newText)).toBeUndefined();
    expect(diffStat('edit', { old_string: oldText, new_string: newText })).toBeUndefined();
    expect(
      diffStat('multiedit', {
        edits: [
          { old_string: oldText, new_string: newText },
          { old_string: 'before', new_string: 'after' },
        ],
      }),
    ).toBeUndefined();
  });
});
