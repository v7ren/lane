import { describe, expect, it } from 'vitest';
import { markDirty, openTab, pinTab, tryCloseTab } from './tabs';

describe('editor tabs', () => {
  it('uses preview tab until edited', () => {
    const tabs = openTab([], 'a.ts', { content: 'a', mtimeMs: 1, preview: true });
    expect(tabs[0]?.preview).toBe(true);
    const dirty = markDirty(tabs, tabs[0]!.id, 'ab');
    expect(dirty[0]?.pinned).toBe(true);
    expect(dirty[0]?.dirty).toBe(true);
  });

  it('replaces preview tab on single-click open', () => {
    const first = openTab([], 'a.ts', { content: 'a', mtimeMs: 1, preview: true });
    const second = openTab(first, 'b.ts', { content: 'b', mtimeMs: 2, preview: true });
    expect(second).toHaveLength(1);
    expect(second[0]?.path).toBe('b.ts');
  });

  it('blocks close when dirty', () => {
    const tabs = openTab([], 'a.ts', { content: 'a', mtimeMs: 1 });
    const dirty = markDirty(tabs, tabs[0]!.id, 'changed');
    expect(tryCloseTab(dirty, dirty[0]!.id).action).toBe('blocked');
    expect(tryCloseTab(dirty, dirty[0]!.id, true).action).toBe('discard');
  });

  it('pins on double-click flow', () => {
    const tabs = openTab([], 'a.ts', { content: 'a', mtimeMs: 1, preview: true });
    const pinned = pinTab(tabs, tabs[0]!.id);
    expect(pinned[0]?.pinned).toBe(true);
    expect(pinned[0]?.preview).toBe(false);
  });
});
