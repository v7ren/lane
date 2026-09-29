import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaneData } from '../../hooks/usePaneRegistry';
import { TerminalShellBar } from './TerminalShellBar';

const agentCatalog = { presets: [], agents: [] } as never;

const shellPane: PaneData = {
  info: {
    id: 'shell-1',
    created_at: 1,
    agent_type: 'powershell',
    cwd: '/tmp',
    pid: 1,
    cols: 80,
    rows: 24,
    status: 'idle',
    last_output_at: 0,
  },
  status: 'idle',
};

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
});

describe('TerminalShellBar', () => {
  it('renders new shell control when a shell is open', () => {
    act(() => {
      root.render(
        <TerminalShellBar
          agentCatalog={agentCatalog}
          terminalPanes={[shellPane]}
          selectedPaneId="shell-1"
          onSelect={() => {}}
          onNewShell={() => {}}
          onCloseShell={() => {}}
        />,
      );
    });
    expect(container.querySelector('[data-testid="terminal-shell-bar"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="New shell"]')).not.toBeNull();
  });

  it('calls onCloseShell when tab close is clicked', () => {
    const onCloseShell = vi.fn();
    act(() => {
      root.render(
        <TerminalShellBar
          agentCatalog={agentCatalog}
          terminalPanes={[shellPane]}
          selectedPaneId="shell-1"
          onSelect={() => {}}
          onNewShell={() => {}}
          onCloseShell={onCloseShell}
        />,
      );
    });
    container.querySelector('[aria-label^="Close"]')?.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(onCloseShell).toHaveBeenCalledWith('shell-1');
  });
});
