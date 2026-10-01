import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellSelectionProvider } from '../lib/shell-selection-context';
import { PaneTerminalHost } from './PaneTerminalHost';
import { TerminalLifecycle } from './TerminalLifecycle';
import { TerminalPark } from './TerminalPark';
import {
  clearTerminalSessionRegistryForTests,
  getTerminalSessionEntry,
} from '../terminal/terminal-session-registry';
import type { PaneData } from '../hooks/usePaneRegistry';

const disposeSpy = vi.fn();
const terminalMountSpy = vi.fn();

vi.mock('../terminal/terminal-session', () => ({
  TerminalSession: class MockTerminalSession {
    private wrapper: HTMLDivElement;
    private xtermRoot: HTMLDivElement;

    constructor(...args: unknown[]) {
      void args;
      this.wrapper = document.createElement('div');
      this.wrapper.className = 'terminal-host';
      this.xtermRoot = document.createElement('div');
      this.xtermRoot.className = 'xterm';
      this.wrapper.appendChild(this.xtermRoot);
    }

    mount(container: HTMLElement) {
      container.appendChild(this.wrapper);
      terminalMountSpy();
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

vi.mock('../lib/tauri', () => ({
  tauri: {
    resize: vi.fn(),
    writeInput: vi.fn(),
  },
}));

const panes: PaneData[] = [
  {
    info: {
      id: 'pane-a',
      created_at: 1,
      agent_type: 'codex',
      cwd: '/tmp',
      pid: 1,
      cols: 80,
      rows: 24,
      status: 'idle',
      last_output_at: 0,
    },
    status: 'idle',
  },
  {
    info: {
      id: 'pane-shell',
      created_at: 1,
      agent_type: 'powershell',
      cwd: '/tmp',
      pid: 2,
      cols: 80,
      rows: 24,
      status: 'idle',
      last_output_at: 0,
    },
    status: 'idle',
  },
];

function shellProvider(ui: ReactNode, bottomTab: 'agent' | 'terminal' = 'agent') {
  return (
    <ShellSelectionProvider
      value={{
        selectedPaneId: 'pane-a',
        setSelectedPaneId: () => {},
        selectedSessionId: null,
        setSelectedSessionId: () => {},
        selectSession: () => {},
        bottomTab,
        setBottomTab: () => {},
        showTui: false,
        setShowTui: () => {},
        selectedTerminalPaneId: 'pane-shell',
        setSelectedTerminalPaneId: () => {},
        railSection: 'sessions',
        setRailSection: () => {},
        settingsOpen: false,
        setSettingsOpen: () => {},
        paletteOpen: false,
        setPaletteOpen: () => {},
        paletteFileMode: false,
        setPaletteFileMode: () => {},
        sidebarColumnOpen: true,
        setSidebarColumnOpen: () => {},
        rightRailOpen: true,
        setRightRailOpen: () => {},
      }}
    >
      {ui}
    </ShellSelectionProvider>
  );
}

function Harness({
  bottomTab,
  showTui,
  panes: paneData = panes,
}: {
  bottomTab: 'agent' | 'terminal';
  showTui: boolean;
  panes?: PaneData[];
}) {
  return (
    <>
      <TerminalPark />
      {showTui && bottomTab === 'agent' && <PaneTerminalHost paneId="pane-a" />}
      {bottomTab === 'terminal' && <PaneTerminalHost paneId="pane-shell" />}
      <TerminalLifecycle
        panes={paneData}
        bottomTab={bottomTab}
        agentPaneId="pane-a"
        showTui={showTui}
        selectedTerminalPaneId="pane-shell"
        subscribePaneData={() => () => {}}
      />
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  clearTerminalSessionRegistryForTests();
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as typeof ResizeObserver;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearTerminalSessionRegistryForTests();
  disposeSpy.mockClear();
  terminalMountSpy.mockClear();
});

describe('TerminalLifecycle (in-flow reparent)', () => {
  it('mounts visible terminals in their host on first render and reparents appended companions immediately', () => {
    const headlessOriginal: PaneData = {
      info: { ...panes[0].info, id: 'claude-headless', surface: 'headless' },
      status: 'idle',
    };
    const companion: PaneData = {
      info: { ...panes[0].info, id: 'claude-companion', created_at: 2 },
      status: 'idle',
    };

    act(() => {
      root.render(shellProvider(<Harness bottomTab="terminal" showTui={false} />, 'terminal'));
    });
    const initialShellTerminal = getTerminalSessionEntry('pane-shell')!.session.getTerminalElement()!;
    expect(container.querySelector('[data-terminal-host="pane-shell"]')!.contains(initialShellTerminal)).toBe(true);

    act(() => {
      root.render(
        shellProvider(
          <>
            <TerminalPark />
            <PaneTerminalHost paneId="claude-companion" />
            <TerminalLifecycle
              panes={[headlessOriginal, companion]}
              bottomTab="agent"
              agentPaneId="claude-companion"
              showTui
              selectedTerminalPaneId={null}
              subscribePaneData={() => () => {}}
            />
          </>,
        ),
      );
    });

    const companionTerminal = getTerminalSessionEntry('claude-companion')!.session.getTerminalElement()!;
    expect(container.querySelector('[data-terminal-host="claude-companion"]')!.contains(companionTerminal)).toBe(true);
    expect(getTerminalSessionEntry('claude-headless')).toBeUndefined();
  });

  it('does not dispose terminal session when switching AGENT ↔ TERMINAL tab', () => {
    act(() => {
      root.render(shellProvider(<Harness bottomTab="agent" showTui={false} />));
    });
    const mountsAfterAgent = terminalMountSpy.mock.calls.length;
    expect(mountsAfterAgent).toBeGreaterThan(0);

    act(() => {
      root.render(shellProvider(<Harness bottomTab="terminal" showTui={false} />, 'terminal'));
    });

    expect(terminalMountSpy.mock.calls.length).toBe(mountsAfterAgent);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('parks xterm wrapper when agent TUI is collapsed', () => {
    act(() => {
      root.render(shellProvider(<Harness bottomTab="agent" showTui={false} />));
    });
    const entry = getTerminalSessionEntry('pane-a');
    expect(entry?.session.getTerminalElement()).toBeTruthy();
    const park = document.getElementById('loomria-terminal-park');
    expect(park?.contains(entry!.session.getTerminalElement()!.parentElement!)).toBe(true);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('reparents the same xterm element across TUI, TERMINAL, and hidden', () => {
    act(() => {
      root.render(shellProvider(<Harness bottomTab="agent" showTui={false} />));
    });
    const xtermEl = getTerminalSessionEntry('pane-a')!.session.getTerminalElement()!;

    act(() => {
      root.render(shellProvider(<Harness bottomTab="agent" showTui={true} />));
    });
    const tuiHost = container.querySelector('[data-terminal-host="pane-a"]')!;
    expect(tuiHost.contains(xtermEl)).toBe(true);

    act(() => {
      root.render(shellProvider(<Harness bottomTab="terminal" showTui={true} />, 'terminal'));
    });
    expect(document.getElementById('loomria-terminal-park')!.contains(xtermEl.parentElement!)).toBe(
      true,
    );

    act(() => {
      root.render(shellProvider(<Harness bottomTab="terminal" showTui={false} />, 'terminal'));
    });
    const shellHost = container.querySelector('[data-terminal-host="pane-shell"]')!;
    const shellXterm = getTerminalSessionEntry('pane-shell')!.session.getTerminalElement()!;
    expect(shellHost.contains(shellXterm)).toBe(true);
    expect(getTerminalSessionEntry('pane-a')!.session.getTerminalElement()).toBe(xtermEl);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('does not dispose when toggling TUI visibility', () => {
    act(() => {
      root.render(shellProvider(<Harness bottomTab="agent" showTui={false} />));
    });
    const mounts = terminalMountSpy.mock.calls.length;

    act(() => {
      root.render(shellProvider(<Harness bottomTab="agent" showTui={true} />));
    });
    act(() => {
      root.render(shellProvider(<Harness bottomTab="agent" showTui={false} />));
    });

    expect(terminalMountSpy.mock.calls.length).toBe(mounts);
    expect(disposeSpy).not.toHaveBeenCalled();
  });
});
