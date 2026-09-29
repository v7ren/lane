import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneRegistryApi } from '../hooks/usePaneRegistry';
import { PersistentPaneSurfaces } from './PersistentPaneSurfaces';

const disposeSpy = vi.fn();
const terminalMountSpy = vi.fn();

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
        agent_type: 'powershell' as const,
        cwd: '/tmp',
        pid: 1,
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  disposeSpy.mockClear();
  terminalMountSpy.mockClear();
});

describe('PersistentPaneSurfaces', () => {
  it('does not dispose terminal session when switching workspace to agent mode', () => {
    act(() => {
      root.render(
        <PersistentPaneSurfaces
          mode="workspace"
          agentPaneId={null}
          showTui={true}
          layoutEpoch={0}
          agentCatalog={agentCatalog}
          registry={registry}
          projectPath={null}
          sessionStates={new Map()}
          onClosePane={() => {}}
          onEnterAgent={() => {}}
        />,
      );
    });

    const mountsAfterWorkspace = terminalMountSpy.mock.calls.length;
    expect(mountsAfterWorkspace).toBeGreaterThan(0);

    act(() => {
      root.render(
        <PersistentPaneSurfaces
          mode="agent"
          agentPaneId="pane-a"
          showTui={true}
          layoutEpoch={1}
          agentCatalog={agentCatalog}
          registry={registry}
          projectPath={null}
          sessionStates={new Map()}
          onClosePane={() => {}}
          onEnterAgent={() => {}}
        />,
      );
    });

    expect(terminalMountSpy.mock.calls.length).toBe(mountsAfterWorkspace);
    expect(disposeSpy).not.toHaveBeenCalled();
  });
});
