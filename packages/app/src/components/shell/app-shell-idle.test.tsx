import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, type AppShellProps } from './AppShell';
import type { PaneRegistryApi } from '../../hooks/usePaneRegistry';
import type { AgentCatalog } from '@loomria/shared';

vi.mock('../../lib/is-tauri', () => ({ isTauriRuntime: () => false }));

vi.mock('../../lib/shell-data', () => ({
  useSessionList: () => [],
  useSelectedSession: () => null,
}));

vi.mock('../../lib/sessions/use-tui-sync', () => ({
  useOpenCodeTuiSync: () => {},
}));

vi.mock('../../lib/demo/DemoContext', () => ({
  useDemoFixtures: () => null,
}));

vi.mock('../../lib/editor/EditorContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/editor/EditorContext')>();
  return {
    ...actual,
    useEditor: () => ({
      tabs: [],
      activeTabId: null,
      mainView: 'launcher' as const,
      explorerView: 'tree' as const,
      quickOpenOpen: false,
      searchOpen: false,
      searchQuery: '',
      searchResults: [],
      pendingRevealLine: null,
      conflict: { open: false },
      setMainView: vi.fn(),
      openFile: vi.fn(),
      setActiveTab: vi.fn(),
      pinActiveTab: vi.fn(),
      updateContent: vi.fn(),
      saveActive: vi.fn(),
      closeTab: vi.fn(),
      openQuickOpen: vi.fn(),
      closeQuickOpen: vi.fn(),
      openSearch: vi.fn(),
      closeSearch: vi.fn(),
      runSearch: vi.fn(),
      fuzzyFiles: vi.fn(),
      conflictKeepMine: vi.fn(),
      conflictReload: vi.fn(),
      conflictCompare: vi.fn(),
    }),
  };
});

vi.mock('../../hooks/usePaneRegistry', () => ({
  usePaneRegistry: () => ({
    panes: new Map(),
    paneList: [],
    initialReady: true,
    spawnPane: vi.fn(),
    killPane: vi.fn(),
    replacePaneAgent: vi.fn(),
    killAll: vi.fn(),
    writeInput: vi.fn(),
    resize: vi.fn(),
    refresh: vi.fn(),
    subscribePaneData: () => () => {},
  }),
}));

vi.mock('../TerminalLifecycle', () => ({
  TerminalLifecycle: () => null,
}));

const emptyRegistry: PaneRegistryApi = {
  panes: new Map(),
  paneList: [],
  initialReady: true,
  spawnPane: vi.fn(),
  killPane: vi.fn(),
  replacePaneAgent: vi.fn(),
  killAll: vi.fn(),
  writeInput: vi.fn(),
  resize: vi.fn(),
  refresh: vi.fn(),
  subscribePaneData: () => () => {},
};

const agentCatalog = { presets: [], agents: [] } as unknown as AgentCatalog;

const baseProps: AppShellProps = {
  agentCatalog,
  registry: emptyRegistry,
  sessionStates: new Map(),
  projectPath: null,
  onProjectPathChange: vi.fn(),
  railConnecting: false,
  selectedPaneId: null,
  setSelectedPaneId: vi.fn(),
  selectedSessionId: null,
  setSelectedSessionId: vi.fn(),
  showTui: false,
  setShowTui: vi.fn(),
  onNewSession: vi.fn(),
  onClosePane: vi.fn(),
  onJumpApproval: vi.fn(),
};

let container: HTMLDivElement;
let root: Root;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.removeItem('loomria-bottom-ratio-touched');
  localStorage.removeItem('loomria-shell-layout-v2');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  errorSpy.mockRestore();
});

describe('AppShell idle render stability', () => {
  it('does not log maximum update depth while idle for 1s', async () => {
    act(() => {
      root.render(<AppShell {...baseProps} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1100));
    });

    const depthErrors = errorSpy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('Maximum update depth exceeded'),
    );
    expect(depthErrors).toHaveLength(0);
  });
});
