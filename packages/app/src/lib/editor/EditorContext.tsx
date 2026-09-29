import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauriRuntime } from '../is-tauri';
import { useSelectedSession } from '../shell-data';
import { usePaneRegistry } from '../../hooks/usePaneRegistry';
import {
  activeTabId,
  markDirty,
  markSaved,
  openTab,
  pinTab,
  tryCloseTab,
  type EditorTab,
} from './tabs';
import {
  keepMine,
  onDiskChange,
  openCompare,
  reloadFromDisk,
  type DiskConflictState,
} from './conflict';
import { fsReadFile, fsStartWatcher, fsWriteFile } from './fs-client';
import { findFiles, findInFiles, type FindMatch } from './opencode-file-actions';
import { readDemoUrlFlags } from '../demo-mode';
import { useDemoFixtures } from '../demo/DemoContext';

export type MainView = 'launcher' | 'editor' | 'review';
export type ExplorerColumnView = 'tree' | 'search';

type EditorContextValue = {
  tabs: EditorTab[];
  activeTabId: string | null;
  mainView: MainView;
  explorerView: ExplorerColumnView;
  quickOpenOpen: boolean;
  /** @deprecated use explorerView === 'search' */
  searchOpen: boolean;
  searchQuery: string;
  searchResults: FindMatch[];
  pendingRevealLine: number | null;
  conflict: DiskConflictState;
  setMainView: (view: MainView) => void;
  openFile: (path: string, opts?: { preview?: boolean; line?: number }) => Promise<void>;
  setActiveTab: (tabId: string) => void;
  pinActiveTab: () => void;
  updateContent: (tabId: string, content: string) => void;
  saveActive: () => Promise<void>;
  closeTab: (tabId: string, force?: boolean) => boolean;
  openQuickOpen: () => void;
  closeQuickOpen: () => void;
  openSearch: () => void;
  closeSearch: () => void;
  runSearch: (query: string) => Promise<void>;
  fuzzyFiles: (query: string) => Promise<string[]>;
  conflictKeepMine: () => void;
  conflictReload: () => Promise<void>;
  conflictCompare: () => void;
};

const EditorContext = createContext<EditorContextValue | null>(null);

export function EditorProvider({
  projectRoot,
  children,
}: {
  projectRoot: string | null | undefined;
  children: ReactNode;
}) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mainView, setMainView] = useState<MainView>('launcher');
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [explorerView, setExplorerView] = useState<ExplorerColumnView>('tree');
  const [pendingRevealLine, setPendingRevealLine] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FindMatch[]>([]);
  const [conflict, setConflict] = useState<DiskConflictState>({
    phase: 'idle',
    diskContent: null,
    diskMtimeMs: null,
  });
  const demoFixtures = useDemoFixtures();
  const registry = usePaneRegistry();
  const selectedSession = useSelectedSession();
  const opencodePaneId = useMemo(() => {
    const pane = registry.paneList.find((p) => p.info.agent_type === 'opencode_native');
    return pane?.info.id ?? selectedSession?.paneId ?? null;
  }, [registry.paneList, selectedSession?.paneId]);

  const root = projectRoot ?? '';

  useEffect(() => {
    if (!root || !isTauriRuntime()) return;
    void fsStartWatcher(root);
  }, [root]);

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;

  useEffect(() => {
    if (!root || !isTauriRuntime()) return;
    let unlisten: (() => void) | undefined;
    void listen<{ root: string; paths: string[] }>('fs://changed', (event) => {
      if (event.payload.root !== root) return;
      for (const rel of event.payload.paths) {
        const tab = tabsRef.current.find((t) => t.path === rel);
        if (!tab) continue;
        void (async () => {
          try {
            const disk = await fsReadFile(root, rel);
            const { state, reload } = onDiskChange(
              conflictRef.current,
              tab.dirty,
              disk.content,
              disk.mtimeMs,
              tab.content,
            );
            setConflict(state);
            if (reload) {
              setTabs((prev) =>
                prev.map((t) =>
                  t.path === rel
                    ? {
                        ...t,
                        content: disk.content,
                        savedContent: disk.content,
                        dirty: false,
                        mtimeMs: disk.mtimeMs,
                      }
                    : t,
                ),
              );
            }
          } catch {
            /* ignore missing */
          }
        })();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [root]);

  const openFile = useCallback(
    async (path: string, opts?: { preview?: boolean; line?: number }) => {
      if (!root) return;
      const data = await fsReadFile(root, path);
      setTabs((prev) => {
        const nextTabs = openTab(prev, path, {
          preview: opts?.preview,
          content: data.content,
          mtimeMs: data.mtimeMs,
        });
        setActiveId(activeTabId(nextTabs, activeId));
        return nextTabs;
      });
      setPendingRevealLine(opts?.line ?? null);
      setMainView('editor');
      setConflict({ phase: 'idle', diskContent: null, diskMtimeMs: null });
    },
    [activeId, root],
  );

  const saveActive = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeId);
    if (!tab || !root) return;
    try {
      const result = await fsWriteFile(root, tab.path, tab.content, tab.mtimeMs);
      setTabs((prev) => markSaved(prev, tab.id, tab.content, result.mtimeMs));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('conflict')) {
        const disk = await fsReadFile(root, tab.path);
        setConflict({
          phase: 'prompt',
          diskContent: disk.content,
          diskMtimeMs: disk.mtimeMs,
        });
      }
      throw err;
    }
  }, [activeId, root, tabs]);

  const closeTab = useCallback(
    (tabId: string, force = false) => {
      const result = tryCloseTab(tabs, tabId, force);
      if (result.action === 'blocked') return false;
      if (result.tabs) {
        setTabs(result.tabs);
        setActiveId(activeTabId(result.tabs, activeId));
        if (result.tabs.length === 0 && mainView === 'editor') setMainView('launcher');
      }
      return true;
    },
    [activeId, mainView, tabs],
  );

  const fuzzyFiles = useCallback(
    async (query: string) => {
      if (opencodePaneId && isTauriRuntime()) {
        try {
          return await findFiles(opencodePaneId, query);
        } catch {
          /* fall through */
        }
      }
      const { fsWalkFiles } = await import('./fs-client');
      return fsWalkFiles(root, query);
    },
    [opencodePaneId, root],
  );

  const runSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query.trim()) {
        setSearchResults([]);
        return;
      }
      if (opencodePaneId && isTauriRuntime()) {
        try {
          setSearchResults(await findInFiles(opencodePaneId, query));
          return;
        } catch {
          /* demo fallback */
        }
      }
      const { getDemoFs } = await import('../demo/editor-fixtures');
      const demo = getDemoFs();
      const q = query.toLowerCase();
      const matches: FindMatch[] = [];
      for (const p of demo.walkFiles('')) {
        try {
          const content = demo.readFile(p).content;
          const lines = content.split('\n');
          lines.forEach((text, i) => {
            if (text.toLowerCase().includes(q)) {
              matches.push({ path: p, line: i + 1, text: text.trim() });
            }
          });
        } catch {
          /* skip */
        }
      }
      setSearchResults(matches);
    },
    [opencodePaneId],
  );

  const demoShotApplied = useRef(false);
  useEffect(() => {
    if (!demoFixtures || demoShotApplied.current) return;
    const params = new URLSearchParams(window.location.search);
    const shot = params.get('shot');
    if (!shot && !readDemoUrlFlags().palette) return;
    demoShotApplied.current = true;
    if (shot === 'editor-tabs') {
      void (async () => {
        await openFile('src/main.ts', { preview: false });
        await openFile('src/app.tsx', { preview: false });
        setTabs((prev) => {
          const id = prev.find((t) => t.path === 'src/main.ts')?.id;
          return id ? markDirty(prev, id, 'edited\n') : prev;
        });
      })();
    }
    if (shot === 'conflict-banner') {
      void (async () => {
        await openFile('src/main.ts', { preview: false });
        setTabs((prev) => {
          const tab = prev.find((t) => t.path === 'src/main.ts');
          return tab ? markDirty(prev, tab.id, 'unsaved local edits') : prev;
        });
        setConflict({ phase: 'prompt', diskContent: 'disk version', diskMtimeMs: Date.now() });
      })();
    }
    if (shot === 'review') setMainView('review');
    if (shot === 'search') {
      setExplorerView('search');
      void runSearch('loomria');
    }
    if (params.get('palette') === '1' || shot === 'quick-open') setQuickOpenOpen(true);
  }, [demoFixtures, openFile, runSearch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveActive();
      }
      if (mod && e.key.toLowerCase() === 'w' && mainView === 'editor') {
        e.preventDefault();
        if (activeId) closeTab(activeId);
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setExplorerView('search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, closeTab, mainView, saveActive]);

  const value = useMemo<EditorContextValue>(
    () => ({
      tabs,
      activeTabId: activeId,
      mainView,
      explorerView,
      quickOpenOpen,
      searchOpen: explorerView === 'search',
      searchQuery,
      searchResults,
      pendingRevealLine,
      conflict,
      setMainView,
      openFile,
      setActiveTab: setActiveId,
      pinActiveTab: () => {
        if (activeId) setTabs((prev) => pinTab(prev, activeId));
      },
      updateContent: (tabId, content) => setTabs((prev) => markDirty(prev, tabId, content)),
      saveActive,
      closeTab,
      openQuickOpen: () => setQuickOpenOpen(true),
      closeQuickOpen: () => setQuickOpenOpen(false),
      openSearch: () => setExplorerView('search'),
      closeSearch: () => setExplorerView('tree'),
      runSearch,
      fuzzyFiles,
      conflictKeepMine: () => setConflict((c) => keepMine(c)),
      conflictReload: async () => {
        const tab = tabs.find((t) => t.id === activeId);
        if (!tab || !root) return;
        const disk = await fsReadFile(root, tab.path);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  content: disk.content,
                  savedContent: disk.content,
                  dirty: false,
                  mtimeMs: disk.mtimeMs,
                }
              : t,
          ),
        );
        setConflict(reloadFromDisk());
      },
      conflictCompare: () => setConflict((c) => openCompare(c)),
    }),
    [
      activeId,
      conflict,
      closeTab,
      fuzzyFiles,
      mainView,
      openFile,
      explorerView,
      quickOpenOpen,
      runSearch,
      saveActive,
      searchQuery,
      pendingRevealLine,
      searchResults,
      tabs,
      root,
    ],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor requires EditorProvider');
  return ctx;
}
