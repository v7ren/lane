import { createRoot, type Root } from 'react-dom/client';
import { act, type ComponentProps, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneRegistryApi } from '../hooks/usePaneRegistry';
import { ShellSelectionProvider } from '../lib/shell-selection-context';
import { PersistentPaneSurfaces } from './PersistentPaneSurfaces';

const disposeSpy = vi.fn();
const terminalMountSpy = vi.fn();
const nudgeReflowSpy = vi.fn();

vi.mock('../terminal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../terminal')>();
  return {
    ...actual,
    TerminalSession: class MockTerminalSession {
      constructor(...args: unknown[]) {
        void args;
      }
      mount() {
        terminalMountSpy();
      }
      dispose() {
        disposeSpy();
      }
      nudgeReflow() {
        nudgeReflowSpy();
        return true;
      }
      setPtyDimensions() {}
    },
  };
});

vi.mock('../lib/tauri', () => ({
  tauri: {
    resize: vi.fn(),
    writeInput: vi.fn(),
  },
}));

const registry: PaneRegistryApi = {
  panes: new Map(),
  paneList: [
    {
      info: {
        id: 'pane-a',
        created_at: 1,
        agent_type: 'codex' as const,
        cwd: '/tmp',
        pid: 1,
        cols: 80,
        rows: 24,
        status: 'idle' as const,
        last_output_at: 0,
      },
      status: 'idle' as const,
    },
    {
      info: {
        id: 'pane-shell',
        created_at: 1,
        agent_type: 'powershell' as const,
        cwd: '/tmp',
        pid: 2,
        cols: 80,
        rows: 24,
        status: 'idle' as const,
        last_output_at: 0,
      },
      status: 'idle' as const,
    },
  ],
  initialReady: true,
  writeInput: vi.fn(),
  resize: vi.fn(),
  refresh: vi.fn(),
  spawnPane: vi.fn(),
  replacePaneAgent: vi.fn(),
  subscribePaneData: () => () => {},
  killPane: vi.fn(),
  killAll: vi.fn(),
};

const agentCatalog = { presets: [], agents: [] } as never;

function shellProvider(ui: ReactNode, overrides?: Partial<ComponentProps<typeof ShellSelectionProvider>['value']>) {
  const value = {
    selectedPaneId: 'pane-a',
    setSelectedPaneId: () => {},
    selectedSessionId: null,
    setSelectedSessionId: () => {},
    selectSession: () => {},
    bottomTab: 'agent' as const,
    setBottomTab: () => {},
    showTui: false,
    setShowTui: () => {},
    selectedTerminalPaneId: 'pane-shell',
    setSelectedTerminalPaneId: () => {},
    railSection: 'sessions' as const,
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
    ...overrides,
  };
  return <ShellSelectionProvider value={value}>{ui}</ShellSelectionProvider>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      private readonly cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(target: Element) {
        this.cb([{ target } as ResizeObserverEntry], this);
      }
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
  disposeSpy.mockClear();
  terminalMountSpy.mockClear();
  nudgeReflowSpy.mockClear();
});

function renderSurfaces(props: Partial<ComponentProps<typeof PersistentPaneSurfaces>> = {}) {
  act(() => {
    root.render(
      shellProvider(
        <div className="relative w-[800px] h-[400px]">
          <PersistentPaneSurfaces
            bottomTab="agent"
            agentPaneId="pane-a"
            selectedTerminalPaneId="pane-shell"
            showTui={false}
            layoutEpoch={0}
            agentCatalog={agentCatalog}
            registry={registry}
            projectPath={null}
            sessionStates={new Map()}
            agentPaneTitle="Pane A"
            tuiSurfaceLive={false}
            onHideTui={() => {}}
            onClosePane={() => {}}
            onEnterAgent={() => {}}
            {...props}
          />
        </div>,
      ),
    );
  });
}

describe('PersistentPaneSurfaces', () => {
  it('does not dispose terminal session when switching AGENT tab visibility', () => {
    renderSurfaces({ bottomTab: 'agent', showTui: false });
    const mountsAfterAgent = terminalMountSpy.mock.calls.length;
    expect(mountsAfterAgent).toBeGreaterThan(0);

    act(() => {
      root.render(
        shellProvider(
          <div className="relative w-[800px] h-[400px]">
            <PersistentPaneSurfaces
              bottomTab="terminal"
              agentPaneId="pane-a"
              selectedTerminalPaneId="pane-shell"
              showTui={false}
              layoutEpoch={1}
              agentCatalog={agentCatalog}
              registry={registry}
              projectPath={null}
              sessionStates={new Map()}
              agentPaneTitle="Pane A"
              tuiSurfaceLive={false}
              onHideTui={() => {}}
              onClosePane={() => {}}
              onEnterAgent={() => {}}
            />
          </div>,
        ),
      );
    });

    expect(terminalMountSpy.mock.calls.length).toBe(mountsAfterAgent);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('parks terminals off-layout when agent TUI is collapsed', () => {
    renderSurfaces({ showTui: false });
    const parked = container.querySelector('[data-pane-id="pane-a"]') as HTMLElement;
    expect(parked).not.toBeNull();
    expect(parked.getAttribute('data-surface-visible')).toBe('0');
    expect(parked.className).toContain('absolute');
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('sets agent TUI layout open when TUI is visible', () => {
    renderSurfaces({ showTui: true, chatWidthPercent: 50 });
    const layout = container.querySelector('[data-agent-tui-layout]');
    expect(layout?.getAttribute('data-agent-tui-layout')).toBe('open');
  });

  it('nudges terminal reflow when TUI surface host is resized', async () => {
    renderSurfaces({ showTui: true, chatWidthPercent: 40 });
    const host = container.querySelector('[data-pane-surface-host="1"]') as HTMLElement;
    expect(host).not.toBeNull();
    nudgeReflowSpy.mockClear();
    act(() => {
      host.style.width = '320px';
      host.getBoundingClientRect();
    });
    if (typeof ResizeObserver !== 'undefined') {
      await new Promise((r) => setTimeout(r, 120));
      expect(nudgeReflowSpy.mock.calls.length).toBeGreaterThan(0);
    }
  });

  it('does not dispose when toggling TUI and layout epoch', () => {
    renderSurfaces({ showTui: false, layoutEpoch: 0 });
    const mounts = terminalMountSpy.mock.calls.length;
    renderSurfaces({ showTui: true, layoutEpoch: 2, chatWidthPercent: 55 });
    renderSurfaces({ showTui: false, layoutEpoch: 3 });
    expect(terminalMountSpy.mock.calls.length).toBe(mounts);
    expect(disposeSpy).not.toHaveBeenCalled();
  });
});
