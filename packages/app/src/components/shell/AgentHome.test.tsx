import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCatalog } from '@loomria/shared';
import { applyKeybinds } from '../../lib/keybinds';
import type { ShellSession } from '../../lib/shell-data';
import { AgentHome } from './AgentHome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const catalog = {
  agents: [
    { id: 'claude', label: 'Claude Code', description: 'Anthropic agent', icon: 'c', is_tui: true,
      command: 'claude', base_args: [], show_in_new_pane_menu: true, default_worker: false },
    { id: 'codex', label: 'Codex', description: '', icon: 'x', is_tui: true,
      command: 'codex', base_args: [], show_in_new_pane_menu: true, default_worker: false },
    { id: 'hidden', label: 'Hidden', description: '', icon: 'h', is_tui: true,
      command: 'h', base_args: [], show_in_new_pane_menu: false, default_worker: false },
  ],
  report: { errors: [] },
} as unknown as AgentCatalog;

function session(n: number): ShellSession {
  return {
    id: `s${n}`, paneId: `pane${n}`, sessionId: `sess${n}`, title: `Session ${n}`,
    agentLabel: 'Claude', agentFamily: 'claude', status: 'idle', updatedAt: Date.now() - n * 60_000, unread: false,
  };
}

let container: HTMLDivElement;
let root: Root;
const q = (sel: string) => container.querySelector(sel) as HTMLElement | null;

function render(over: Partial<Parameters<typeof AgentHome>[0]> = {}) {
  const props = {
    projectPath: '/home/dev/my-project',
    agentCatalog: catalog,
    recentSessions: [] as ShellSession[],
    onNewSession: vi.fn(),
    onSelectSession: vi.fn(),
    onChangeFolder: vi.fn(),
    ...over,
  };
  act(() => root.render(<AgentHome {...props} />));
  return props;
}

beforeEach(() => {
  applyKeybinds(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AgentHome', () => {
  it('shows the heading and the project basename with the full path as tooltip', () => {
    render();
    expect(q('[data-testid="agent-home"]')?.textContent).toContain('What should we work on?');
    const label = q('[data-testid="agent-home-project"] span[title]');
    expect(label?.textContent).toBe('my-project');
    expect(label?.getAttribute('title')).toBe('/home/dev/my-project');
  });

  it('handles Windows paths and a missing project', () => {
    render({ projectPath: 'C:\\Users\\dev\\loomria' });
    expect(q('[data-testid="agent-home-project"]')?.textContent).toContain('loomria');
    render({ projectPath: null });
    expect(q('[data-testid="agent-home-project"]')?.textContent).toContain('No folder selected');
  });

  it('calls onChangeFolder', () => {
    const p = render();
    act(() => q('[data-testid="agent-home-change-folder"]')!.click());
    expect(p.onChangeFolder).toHaveBeenCalledTimes(1);
  });

  it('renders one card per launchable agent and starts a session on click', () => {
    const p = render();
    expect(container.querySelectorAll('[data-testid^="agent-home-card-"]')).toHaveLength(2);
    expect(q('[data-testid="agent-home-card-claude"]')?.textContent).toContain('Anthropic agent');
    act(() => q('[data-testid="agent-home-card-codex"]')!.click());
    expect(p.onNewSession).toHaveBeenCalledWith('codex');
  });

  it('lists at most five recent sessions and selects through the callback', () => {
    const p = render({ recentSessions: [1, 2, 3, 4, 5, 6, 7].map(session) });
    const rows = container.querySelectorAll('[data-testid="agent-home-session"]');
    expect(rows).toHaveLength(5);
    act(() => (rows[1] as HTMLElement).click());
    expect(p.onSelectSession).toHaveBeenCalledWith('pane2', 'sess2');
  });

  it('omits the recent section when there are no sessions', () => {
    render();
    expect(q('[data-testid="agent-home-recent"]')).toBeNull();
  });

  it('reads hint combos from the effective keybinds', () => {
    render();
    expect(q('[data-testid="agent-home-hints"]')?.textContent).toContain('Ctrl+Shift+M');
    applyKeybinds({ uiMode: 'Ctrl+Alt+I' });
    render();
    expect(q('[data-testid="agent-home-hints"]')?.textContent).toContain('Ctrl+Alt+I');
    expect(q('[data-testid="agent-home-hints"]')?.textContent).toContain('Ctrl+K');
  });
});
