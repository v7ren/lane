export type EditorTab = {
  id: string;
  path: string;
  label: string;
  pinned: boolean;
  preview: boolean;
  dirty: boolean;
  content: string;
  savedContent: string;
  mtimeMs: number | null;
  /** Bumped when content is replaced from outside the editor (disk reload / re-open). */
  revision?: number;
};

export type CloseTabResult =
  | { action: 'closed' }
  | { action: 'blocked'; reason: 'unsaved' }
  | { action: 'discard' };

export function tabLabelFromPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

export function openTab(
  tabs: EditorTab[],
  path: string,
  opts: { preview?: boolean; content: string; mtimeMs: number | null },
): EditorTab[] {
  const existing = tabs.find((t) => t.path === path);
  if (existing) {
    return tabs.map((t) =>
      t.path === path
        ? {
            ...t,
            content: opts.content,
            savedContent: opts.content,
            mtimeMs: opts.mtimeMs,
            dirty: false,
            revision: (t.revision ?? 0) + 1,
            preview: opts.preview ?? t.preview,
          }
        : t,
    );
  }
  const preview = opts.preview ?? true;
  const withoutPreview = preview ? tabs.filter((t) => !t.preview || t.pinned) : tabs;
  const tab: EditorTab = {
    id: `tab-${path}`,
    path,
    label: tabLabelFromPath(path),
    pinned: !preview,
    preview,
    dirty: false,
    content: opts.content,
    savedContent: opts.content,
    mtimeMs: opts.mtimeMs,
  };
  return [...withoutPreview, tab];
}

export function pinTab(tabs: EditorTab[], tabId: string): EditorTab[] {
  return tabs.map((t) => (t.id === tabId ? { ...t, pinned: true, preview: false } : t));
}

export function markDirty(tabs: EditorTab[], tabId: string, content: string): EditorTab[] {
  return tabs.map((t) =>
    t.id === tabId ? { ...t, content, dirty: content !== t.savedContent, preview: false, pinned: true } : t,
  );
}

export function markSaved(tabs: EditorTab[], tabId: string, content: string, mtimeMs: number): EditorTab[] {
  return tabs.map((t) =>
    t.id === tabId ? { ...t, content, savedContent: content, dirty: false, mtimeMs } : t,
  );
}

export function tryCloseTab(tabs: EditorTab[], tabId: string, force = false): CloseTabResult & { tabs?: EditorTab[] } {
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab) return { action: 'closed', tabs };
  if (tab.dirty && !force) return { action: 'blocked', reason: 'unsaved' };
  return { action: force && tab.dirty ? 'discard' : 'closed', tabs: tabs.filter((t) => t.id !== tabId) };
}

export function activeTabId(tabs: EditorTab[], current: string | null): string | null {
  if (current && tabs.some((t) => t.id === current)) return current;
  return tabs[tabs.length - 1]?.id ?? null;
}
