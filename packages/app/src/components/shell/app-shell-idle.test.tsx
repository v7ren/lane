import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, type AppShellProps } from './AppShell';
import type { PaneRegistryApi } from '../../hooks/usePaneRegistry';
import type { AgentCatalog } from '@loomria/shared';
import { resetTuiCompanionsForTests, setTuiCompanion } from '../../lib/tui-companions';

const runtime = vi.hoisted(() => ({ desktop: false }));
vi.mock('../../lib/is-tauri', () => ({ isTauriRuntime: () => runtime.desktop }));
vi.mock('../agent/AgentView', () => ({ AgentView: () => <div>Agent transcript</div> }));
vi.mock('../../lib/session-notify-prefs', () => ({ isSessionMuted: async () => false }));
vi.mock('./SidebarPanel', () => ({ SidebarPanel: () => null }));
vi.mock('./RightRail', () => ({ RightRail: () => null }));

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
  runtime.desktop = false;
  resetTuiCompanionsForTests();
  // These tests cover the IDE layout (bottom panel, explorer); agent mode is in app-shell-mode.test.tsx.
  localStorage.setItem('loomria-ui-mode', 'ide');
  localStorage.removeItem('loomria-bottom-ratio-touched');
  localStorage.removeItem('loomria-shell-layout-v2');
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  localStorage.removeItem('loomria-ui-mode');
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

describe('Claude TUI surface visibility', () => {
  function renderClaude(chatStatus: 'running' | 'error', companionStatus?: 'running' | 'error') {
    runtime.desktop = true;
    const chat = {
      info: { id: 'claude-chat', agent_type: 'claude', surface: 'headless' as const,
        cwd: '/tmp', created_at: 1, pid: 1, cols: 1, rows: 1, status: chatStatus,
        last_output_at: 0 },
      status: chatStatus,
    };
    const companion = companionStatus ? [{
      info: { ...chat.info, id: 'claude-tui', surface: 'tui' as const,
        cols: 80, rows: 24, status: companionStatus },
      status: companionStatus,
    }] : [];
    if (companionStatus) setTuiCompanion(chat.info.id, 'claude-tui');
    act(() => root.render(<AppShell {...baseProps}
      selectedPaneId={chat.info.id} showTui
      registry={{ ...emptyRegistry, paneList: [chat, ...companion] }} />));
  }

  it('shows the companion terminal when the headless chat reports a rate limit error', () => {
    renderClaude('error', 'running');
    const host = container.querySelector('[data-terminal-host="claude-tui"]');
    expect(host).toBeTruthy();
    expect(host?.classList.contains('invisible')).toBe(false);
    expect(container.textContent).not.toContain('Terminal not connected');
  });

  it('keeps terminal exit diagnostics visible after the companion exits', () => {
    renderClaude('error', 'error');
    expect(container.querySelector('[data-terminal-host="claude-tui"]')?.classList.contains('invisible'))
      .toBe(false);
  });

  it('shows a disconnected placeholder when a headless chat has no companion', () => {
    renderClaude('running');
    expect(container.textContent).toContain('Terminal not connected');
    expect(container.querySelector('[data-terminal-host="claude-chat"]')?.classList.contains('invisible'))
      .toBe(true);
  });

  it('closes the TUI when selecting another headless chat without a companion', () => {
    renderClaude('error', 'running');
    const setShowTui = vi.fn();
    const next = {
      info: { id: 'other-chat', agent_type: 'claude', surface: 'headless', cwd: '/tmp',
        created_at: 2, pid: 2, cols: 1, rows: 1, status: 'running' as const, last_output_at: 0 },
      status: 'running' as const,
    };
    act(() => root.render(<AppShell {...baseProps} selectedPaneId={next.info.id}
      showTui setShowTui={setShowTui} registry={{ ...emptyRegistry, paneList: [next] }} />));
    expect(setShowTui).toHaveBeenCalledWith(false);
  });

  it('keeps an existing companion open when switching to its headless chat', () => {
    renderClaude('running');
    const setShowTui = vi.fn();
    const next = {
      info: { id: 'other-chat', agent_type: 'claude', surface: 'headless', cwd: '/tmp',
        created_at: 2, pid: 2, cols: 1, rows: 1, status: 'error' as const, last_output_at: 0 },
      status: 'error' as const,
    };
    const terminal = { info: { ...next.info, id: 'other-tui', surface: 'tui' }, status: 'error' as const };
    setTuiCompanion(next.info.id, terminal.info.id);
    act(() => root.render(<AppShell {...baseProps} selectedPaneId={next.info.id}
      showTui setShowTui={setShowTui} registry={{ ...emptyRegistry, paneList: [next, terminal] }} />));
    expect(setShowTui).not.toHaveBeenCalled();
    expect(container.querySelector('[data-terminal-host="other-tui"]')?.classList.contains('invisible'))
      .toBe(false);
  });
});
