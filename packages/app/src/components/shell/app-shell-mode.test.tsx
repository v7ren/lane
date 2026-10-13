import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCatalog } from '@loomria/shared';
import { AppShell, type AppShellProps } from './AppShell';
import type { PaneData, PaneRegistryApi } from '../../hooks/usePaneRegistry';
import { resetTuiCompanionsForTests } from '../../lib/tui-companions';
import { applyKeybinds } from '../../lib/keybinds';
import {
  clearTerminalSessionRegistryForTests,
  getTerminalSessionEntry,
} from '../../terminal/terminal-session-registry';
import type { ShellSession } from '../../lib/shell-data';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({ desktop: false }));
const sessions = vi.hoisted(() => ({ list: [] as unknown[] }));
const captured = vi.hoisted(() => ({ editor: null as null | { openFile: (p: string) => Promise<void> } }));
const disposeSpy = vi.hoisted(() => vi.fn());
const updateSettingsSpy = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../lib/is-tauri', () => ({ isTauriRuntime: () => runtime.desktop }));
vi.mock('../agent/AgentView', () => ({
  AgentView: (p: { embedded?: boolean; paneId: string }) => (
    <div data-testid="agent-view" data-embedded={String(Boolean(p.embedded))}>
      Agent transcript {p.paneId}
    </div>
  ),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('../../lib/session-notify-prefs', () => ({ isSessionMuted: async () => false }));
vi.mock('./SidebarPanel', () => ({ SidebarPanel: () => null }));
vi.mock('./RightRail', () => ({ RightRail: () => null }));
vi.mock('./ExplorerPanel', () => ({ ExplorerPanel: () => <div data-testid="explorer-panel" /> }));
vi.mock('../editor/MonacoEditorPane', () => ({ MonacoEditorPane: () => <div data-testid="monaco" /> }));
vi.mock('../editor/QuickOpen', async () => {
  const { useEditor } = await import('../../lib/editor/EditorContext');
  return {
    QuickOpen: () => (useEditor().quickOpenOpen ? <div data-testid="quick-open" /> : null),
  };
});
vi.mock('../review/ReviewPanel', () => ({ ReviewPanel: () => <div data-testid="review-panel" /> }));
vi.mock('../../lib/shell-data', () => ({
  useSessionList: () => sessions.list,
  useSelectedSession: () => null,
}));
vi.mock('../../lib/sessions/use-tui-sync', () => ({ useOpenCodeTuiSync: () => {} }));
vi.mock('../../lib/demo/DemoContext', () => ({ useDemoFixtures: () => null }));
vi.mock('../../lib/editor/fs-client', () => ({
  fsReadFile: vi.fn(async () => ({ content: 'hello', mtimeMs: 1 })),
  fsListDir: vi.fn(async () => []),
  fsStartWatcher: vi.fn(async () => undefined),
  fsWriteFile: vi.fn(),
  fsWalkFiles: vi.fn(async () => []),
  fsCreate: vi.fn(),
  fsRename: vi.fn(),
  fsDelete: vi.fn(),
}));
vi.mock('../../lib/editor/EditorContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/editor/EditorContext')>();
  return {
    ...actual,
    useEditor: () => {
      const value = actual.useEditor();
      captured.editor = value;
      return value;
    },
  };
});
vi.mock('../../lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/settings')>();
  return { ...actual, updateSettings: updateSettingsSpy };
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
vi.mock('../../terminal/terminal-session', () => ({
  TerminalSession: class MockTerminalSession {
    private wrapper = document.createElement('div');
    private xtermRoot = document.createElement('div');
    constructor() {
      this.xtermRoot.className = 'xterm';
      this.wrapper.appendChild(this.xtermRoot);
    }
    mount(container: HTMLElement) {
      container.appendChild(this.wrapper);
    }
    reparent(target: HTMLElement) {
      target.appendChild(this.wrapper);
    }
    getTerminalElement() {
      return this.xtermRoot;
    }
    dispose() {
      disposeSpy();
      this.wrapper.remove();
    }
    nudgeReflow() {
      return true;
    }
    setPtyDimensions() {}
  },
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

const agentCatalog = {
  agents: [
    { id: 'claude', label: 'Claude Code', description: 'Anthropic agent', icon: 'c', is_tui: true,
      command: 'claude', base_args: [], show_in_new_pane_menu: true, default_worker: false },
  ],
  report: { errors: [] },
} as unknown as AgentCatalog;

const baseProps: AppShellProps = {
  agentCatalog,
  registry: emptyRegistry,
  sessionStates: new Map(),
  projectPath: '/home/dev/my-project',
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

const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** updateSettings calls that carry ui_mode (layout saves also go through updateSettings). */
const uiModeWrites = () =>
  (updateSettingsSpy.mock.calls as unknown as [Record<string, unknown>][]).filter(
    ([patch]) => patch && 'ui_mode' in patch,
  );

function press(init: KeyboardEventInit & { key: string }) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

function mount(props: Partial<AppShellProps> = {}) {
  act(() => root.render(<AppShell {...baseProps} {...props} />));
}

beforeEach(() => {
  runtime.desktop = false;
  sessions.list = [];
  captured.editor = null;
  applyKeybinds(undefined);
  resetTuiCompanionsForTests();
  clearTerminalSessionRegistryForTests();
  disposeSpy.mockClear();
  updateSettingsSpy.mockClear();
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearTerminalSessionRegistryForTests();
  vi.restoreAllMocks();
});

describe('AppShell agent mode (default)', () => {
  it('shows AgentHome and hides explorer, editor and bottom panel', () => {
    mount();
    expect(q('agent-home')).not.toBeNull();
    expect(q('explorer-panel')).toBeNull();
    expect(q('editor-workspace')).toBeNull();
    expect(q('bottom-panel')).toBeNull();
    expect(q('sidebar-column')).not.toBeNull();
    expect(q('ui-mode-agent')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders the conversation full height and not embedded when a pane is selected', () => {
    mount({ selectedPaneId: 'pane-1' });
    expect(q('agent-home')).toBeNull();
    expect(q('agent-view')!.dataset.embedded).toBe('false');
    expect(q('bottom-panel')).toBeNull();
  });

  it('starts a session from an AgentHome card', () => {
    const onNewSession = vi.fn();
    mount({ onNewSession });
    act(() => q('agent-home-card-claude')!.click());
    expect(onNewSession).toHaveBeenCalledWith('claude');
  });

  it('lists recent sessions for this project and selects through setSelectedPaneId', () => {
    const mk = (n: number, dir?: string): ShellSession => ({
      id: `s${n}`, paneId: `p${n}`, sessionId: `sess${n}`, title: `Title ${n}`, agentLabel: 'Claude',
      agentFamily: 'claude', status: 'idle', updatedAt: n, unread: false, workspaceDirectory: dir,
    });
    sessions.list = [mk(1, '/home/dev/my-project'), mk(2, '/elsewhere'), mk(3)];
    const setSelectedPaneId = vi.fn();
    mount({ setSelectedPaneId });
    const rows = Array.from(container.querySelectorAll('[data-testid="agent-home-session"]'));
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Title 3'),
      expect.stringContaining('Title 1'),
    ]);
    act(() => (rows[1] as HTMLElement).click());
    expect(setSelectedPaneId).toHaveBeenCalledWith('p1');
  });
});

describe('AppShell mode switching', () => {
  it('clicking IDE shows explorer, editor workspace and bottom panel and persists the choice', () => {
    mount();
    act(() => q('ui-mode-ide')!.click());
    expect(q('agent-home')).toBeNull();
    expect(q('explorer-panel')).not.toBeNull();
    expect(q('editor-workspace')).not.toBeNull();
    expect(q('bottom-panel')).not.toBeNull();
    expect(q('ui-mode-ide')!.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('loomria-ui-mode')).toBe('ide');
    expect(updateSettingsSpy).toHaveBeenCalledWith({ ui_mode: 'ide' });
  });

  it('starts in IDE mode when the cache says so, with the embedded conversation', () => {
    localStorage.setItem('loomria-ui-mode', 'ide');
    mount({ selectedPaneId: 'pane-1' });
    expect(q('explorer-panel')).not.toBeNull();
    expect(q('agent-view')!.dataset.embedded).toBe('true');
    expect(q('agent-home')).toBeNull();
  });

  it('Ctrl+Shift+M toggles the mode both ways', () => {
    mount();
    press({ key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true });
    expect(q('bottom-panel')).not.toBeNull();
    press({ key: 'M', code: 'KeyM', ctrlKey: true, shiftKey: true });
    expect(q('agent-home')).not.toBeNull();
    expect(q('bottom-panel')).toBeNull();
  });

  it('Ctrl+J and Ctrl+` switch an agent-mode shell to IDE with the bottom panel open', () => {
    mount();
    press({ key: 'j', code: 'KeyJ', ctrlKey: true });
    expect(q('bottom-panel')).not.toBeNull();

    act(() => q('ui-mode-agent')!.click());
    expect(q('bottom-panel')).toBeNull();
    press({ key: '`', code: 'Backquote', ctrlKey: true });
    expect(q('bottom-panel')).not.toBeNull();
    expect(q('bottom-tab-terminal')!.getAttribute('aria-selected') ?? q('bottom-tab-terminal')!.className)
      .toBeTruthy();
    expect(container.querySelector('[data-bottom-panel-view="terminal"]')!.classList.contains('hidden'))
      .toBe(false);
  });

  it('Ctrl+P alone opens quick open in agent mode without switching modes', () => {
    mount();
    press({ key: 'p', code: 'KeyP', ctrlKey: true });
    expect(q('quick-open')).not.toBeNull();
    expect(q('editor-workspace')).toBeNull();
    expect(q('agent-home')).not.toBeNull();
    expect(q('ui-mode-agent')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('actually opening a file from quick open then switches to IDE without persisting', async () => {
    localStorage.setItem('loomria-ui-mode', 'agent');
    mount();
    press({ key: 'p', code: 'KeyP', ctrlKey: true });
    await act(async () => {
      await captured.editor!.openFile('src/a.ts');
    });
    expect(q('editor-workspace')).not.toBeNull();
    expect(localStorage.getItem('loomria-ui-mode')).toBe('agent');
    expect(uiModeWrites()).toEqual([]);
  });

  it('opening a file in agent mode switches to IDE', async () => {
    mount();
    expect(q('editor-workspace')).toBeNull();
    await act(async () => {
      await captured.editor!.openFile('src/a.ts');
    });
    expect(q('editor-workspace')).not.toBeNull();
    expect(q('monaco')).not.toBeNull();
  });

  it('opening the Review view in agent mode switches to IDE', () => {
    mount();
    act(() => (captured.editor as unknown as { setMainView: (v: string) => void }).setMainView('review'));
    expect(q('review-panel')).not.toBeNull();
  });

  it('does not bounce back to IDE after returning to agent mode with tabs open', async () => {
    mount();
    await act(async () => {
      await captured.editor!.openFile('src/a.ts');
    });
    expect(q('editor-workspace')).not.toBeNull();
    act(() => q('ui-mode-agent')!.click());
    await act(async () => undefined);
    expect(q('agent-home')).not.toBeNull();
    expect(q('editor-workspace')).toBeNull();
  });

  it('the palette lists a toggle command labelled by mode', () => {
    mount();
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }),
      );
    });
    expect(container.textContent).toContain('Switch to IDE mode');
  });
});

describe('AppShell agent-mode layout', () => {
  const rail = () => q('right-rail-column');
  const toggle = () =>
    container.querySelector('button[aria-label="Toggle details panel"]') as HTMLButtonElement | null;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  it('hides the right rail by default even on wide viewports and always shows the toggle', () => {
    mount();
    expect(rail()).toBeNull();
    expect(toggle()).not.toBeNull();
  });

  it('opens and closes the rail with the toggle and remembers the choice', () => {
    mount();
    act(() => toggle()!.click());
    expect(rail()).not.toBeNull();
    expect(toggle()!.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('loomria-agent-right-rail')).toBe('open');
    act(() => toggle()!.click());
    expect(rail()).toBeNull();
    expect(localStorage.getItem('loomria-agent-right-rail')).toBe('closed');
  });

  it('restores an open rail from storage', () => {
    localStorage.setItem('loomria-agent-right-rail', 'open');
    mount();
    expect(rail()).not.toBeNull();
  });

  it('keeps the old responsive rule in IDE mode (open on wide viewports, no details toggle)', () => {
    localStorage.setItem('loomria-ui-mode', 'ide');
    mount();
    expect(rail()).not.toBeNull();
    expect(toggle()).toBeNull();
  });

  it('constrains the centre column and marks the chat/TUI split row', () => {
    mount({ selectedPaneId: 'pane-1', showTui: true });
    const center = q('agent-center')!;
    expect(center.className).toContain('overflow-hidden');
    expect(center.className).toContain('min-w-0');
    const row = center.querySelector('[data-agent-split-row]');
    expect(row).not.toBeNull();
    expect(row!.querySelector('[data-agent-tui-column]')).not.toBeNull();
  });

  it('marks the split row in IDE mode too', () => {
    localStorage.setItem('loomria-ui-mode', 'ide');
    mount({ selectedPaneId: 'pane-1', showTui: true });
    expect(container.querySelector('[data-agent-split-row]')).not.toBeNull();
  });

  it('does not persist an automatic switch to IDE, but persists the explicit title-bar one', async () => {
    localStorage.setItem('loomria-ui-mode', 'agent');
    mount();
    await act(async () => {
      await captured.editor!.openFile('src/a.ts');
    });
    expect(q('editor-workspace')).not.toBeNull();
    expect(localStorage.getItem('loomria-ui-mode')).toBe('agent');
    expect(uiModeWrites()).toEqual([]);

    act(() => q('ui-mode-agent')!.click());
    act(() => q('ui-mode-ide')!.click());
    expect(localStorage.getItem('loomria-ui-mode')).toBe('ide');
    expect(updateSettingsSpy).toHaveBeenCalledWith({ ui_mode: 'ide' });
  });

  it('does not persist the Review or Ctrl+J auto-switches', () => {
    localStorage.setItem('loomria-ui-mode', 'agent');
    mount();
    press({ key: 'j', code: 'KeyJ', ctrlKey: true });
    expect(q('bottom-panel')).not.toBeNull();
    expect(localStorage.getItem('loomria-ui-mode')).toBe('agent');
    expect(uiModeWrites()).toEqual([]);
  });

  it('focuses the composer after switching back to agent mode with a pane selected', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    localStorage.setItem('loomria-ui-mode', 'ide');
    mount({ selectedPaneId: 'pane-1' });
    const ta = document.createElement('textarea');
    ta.setAttribute('data-agent-composer', '');
    document.body.appendChild(ta);
    act(() => q('ui-mode-agent')!.click());
    expect(document.activeElement).toBe(ta);
    ta.remove();
  });
});

describe('AppShell terminal mounting across modes', () => {
  const tuiPane: PaneData = {
    info: { id: 'tui-pane', created_at: 1, agent_type: 'codex', cwd: '/tmp', pid: 1, cols: 80,
      rows: 24, status: 'idle', last_output_at: 0 },
    status: 'idle',
  };
  const shellPane: PaneData = {
    info: { id: 'shell-pane', created_at: 2, agent_type: 'powershell', cwd: '/tmp', pid: 2, cols: 80,
      rows: 24, status: 'idle', last_output_at: 0 },
    status: 'idle',
  };

  const xterm = (id: string) => getTerminalSessionEntry(id)!.session.getTerminalElement()!;
  const hostOf = (id: string) => container.querySelector(`[data-terminal-host="${id}"]`);
  const parked = (id: string) =>
    document.getElementById('loomria-terminal-park')!.contains(xterm(id));
  const hostedIn = (id: string) => {
    const hosts = container.querySelectorAll(`[data-terminal-host="${id}"]`);
    return hosts.length === 1 && hosts[0].contains(xterm(id));
  };

  function mountTerminals() {
    runtime.desktop = true;
    mount({
      selectedPaneId: 'tui-pane',
      showTui: true,
      registry: { ...emptyRegistry, paneList: [tuiPane, shellPane] },
    });
  }

  it('mounts the Claude/agent TUI column in agent mode and keeps shells parked', () => {
    mountTerminals();
    expect(q('bottom-panel')).toBeNull();
    expect(hostedIn('tui-pane')).toBe(true);
    expect(hostOf('shell-pane')).toBeNull();
    expect(parked('shell-pane')).toBe(true);
  });

  it('reparents the same xterm elements through every mode and tab switch without disposing', () => {
    mountTerminals();
    const tuiEl = xterm('tui-pane');
    const shellEl = xterm('shell-pane');

    act(() => q('ui-mode-ide')!.click());
    expect(hostedIn('tui-pane')).toBe(true);
    expect(parked('shell-pane')).toBe(true);

    act(() => q('bottom-tab-terminal')!.click());
    expect(hostedIn('shell-pane')).toBe(true);
    expect(parked('tui-pane')).toBe(true);

    // Stale bottomTab === 'terminal' must not hide the TUI column in agent mode.
    act(() => q('ui-mode-agent')!.click());
    expect(hostOf('shell-pane')).toBeNull();
    expect(parked('shell-pane')).toBe(true);
    expect(hostedIn('tui-pane')).toBe(true);

    act(() => q('ui-mode-ide')!.click());
    expect(hostedIn('shell-pane')).toBe(true);
    expect(parked('tui-pane')).toBe(true);

    act(() => q('bottom-tab-agent')!.click());
    expect(hostedIn('tui-pane')).toBe(true);
    expect(parked('shell-pane')).toBe(true);

    act(() => q('ui-mode-agent')!.click());
    expect(hostedIn('tui-pane')).toBe(true);

    expect(xterm('tui-pane')).toBe(tuiEl);
    expect(xterm('shell-pane')).toBe(shellEl);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('Ctrl+` from agent mode lands on a visible, hosted user shell', () => {
    mountTerminals();
    press({ key: '`', code: 'Backquote', ctrlKey: true });
    expect(q('bottom-panel')).not.toBeNull();
    expect(hostedIn('shell-pane')).toBe(true);
    expect(parked('tui-pane')).toBe(true);
  });
});
