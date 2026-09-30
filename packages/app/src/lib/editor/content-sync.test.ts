import { describe, expect, it } from 'vitest';
import { shouldApplyExternalContent } from './content-sync';
import { markDirty, openTab, type EditorTab } from './tabs';

describe('shouldApplyExternalContent', () => {
  it('never overwrites the editor when the revision is unchanged (fast typing, stale prop)', () => {
    expect(
      shouldApplyExternalContent({
        revision: 0,
        appliedRevision: 0,
        tabContent: 'the qui',
        editorValue: 'the quick brown fox',
      }),
    ).toBe(false);
  });

  it('applies content after an external reload', () => {
    expect(
      shouldApplyExternalContent({
        revision: 1,
        appliedRevision: 0,
        tabContent: 'from disk',
        editorValue: 'old',
      }),
    ).toBe(true);
  });

  it('skips the set when the editor already has that content', () => {
    expect(
      shouldApplyExternalContent({
        revision: 2,
        appliedRevision: 1,
        tabContent: 'same',
        editorValue: 'same',
      }),
    ).toBe(false);
  });
});

describe('tab revision', () => {
  const tab = (over: Partial<EditorTab> = {}): EditorTab => ({
    id: 'tab-a',
    path: 'a.ts',
    label: 'a.ts',
    pinned: false,
    preview: false,
    dirty: false,
    content: 'one',
    savedContent: 'one',
    mtimeMs: 1,
    ...over,
  });

  it('typing does not bump the revision', () => {
    const [next] = markDirty([tab()], 'tab-a', 'one two');
    expect(next!.revision ?? 0).toBe(0);
  });

  it('re-opening an open file bumps the revision', () => {
    const [next] = openTab([tab()], 'a.ts', { content: 'disk', mtimeMs: 2 });
    expect(next!.revision).toBe(1);
    expect(next!.content).toBe('disk');
  });
});
