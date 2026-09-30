import { describe, expect, it } from 'vitest';
import {
  decideFileEdited,
  keepMine,
  onDiskChange,
  openCompare,
  reloadFromDisk,
} from './conflict';
import { emitFileEdited, fileEditedPathsFromProps, subscribeFileEdited } from './file-edited-bus';

describe('decideFileEdited', () => {
  const root = 'C:\\proj\\app';
  const tabs = [
    { path: 'src/a.ts', dirty: true },
    { path: 'src/b.ts', dirty: false },
  ];

  it('dirty + match -> conflict', () => {
    expect(decideFileEdited('src/a.ts', tabs, root)).toEqual({ action: 'conflict', tabPath: 'src/a.ts' });
  });
  it('clean + match -> reload', () => {
    expect(decideFileEdited('src/b.ts', tabs, root)).toEqual({ action: 'reload', tabPath: 'src/b.ts' });
  });
  it('no match -> ignore', () => {
    expect(decideFileEdited('src/c.ts', tabs, root)).toEqual({ action: 'ignore' });
  });
  it('normalizes separators and absolute paths', () => {
    expect(decideFileEdited('C:\\proj\\app\\src\\a.ts', tabs, root).action).toBe('conflict');
    expect(decideFileEdited('c:/proj/app/src/b.ts', tabs, root).action).toBe('reload');
    expect(decideFileEdited('./src\\a.ts', tabs, root).action).toBe('conflict');
    expect(decideFileEdited('/home/u/p/src/a.ts', tabs, '/home/u/p').action).toBe('conflict');
  });
  it('does not match sibling roots or the root itself', () => {
    expect(decideFileEdited('C:/proj/app2/src/a.ts', tabs, root).action).toBe('ignore');
    expect(decideFileEdited('C:/proj/app', tabs, root).action).toBe('ignore');
  });
});

describe('file-edited bus', () => {
  it('extracts file and files props', () => {
    expect(fileEditedPathsFromProps({ file: 'a.ts' })).toEqual(['a.ts']);
    expect(fileEditedPathsFromProps({ files: ['a.ts', 3, 'b.ts'] })).toEqual(['a.ts', 'b.ts']);
    expect(fileEditedPathsFromProps({})).toEqual([]);
  });
  it('delivers to subscribers until unsubscribed', () => {
    const seen: string[][] = [];
    const off = subscribeFileEdited((p) => seen.push(p));
    emitFileEdited(['x']);
    emitFileEdited([]);
    off();
    emitFileEdited(['y']);
    expect(seen).toEqual([['x']]);
  });
});

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
