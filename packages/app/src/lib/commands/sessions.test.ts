import { describe, expect, it } from 'vitest';
import { isSessionReverted } from '../shell-data';
import type { ShellSession } from '../shell-data';
import { buildShellCommandRegistry, createCommandRegistry } from './index';
import { registerAgentCommands } from './agent';
import { registerEditorCommands } from './editor';
import { registerSessionCommands } from './sessions';

describe('command registry', () => {
  it('registers session and stub commands', () => {
    const registry = createCommandRegistry();
    const commands = buildShellCommandRegistry({
      registry,
      registerSessionCommands: (r) =>
        registerSessionCommands(r, {
          agentCatalog: { agents: [], report: { errors: [] } },
          sessions: [],
          selected: null,
          onNewAgent: () => {},
          onSelectSession: () => {},
          onToggleBottom: () => {},
          onToggleSidebar: () => {},
          onToggleRightRail: () => {},
          onOpenSettings: () => {},
          onFocusComposer: () => {},
          onSwitchAgentTab: () => {},
          onSwitchTerminalTab: () => {},
        }),
      registerAgentCommands,
      registerEditorCommands: (r) =>
        registerEditorCommands(r, {
          onQuickOpen: () => {},
          onSearchPanel: () => {},
          onReview: () => {},
          onSave: () => {},
          onCloseTab: () => {},
        }),
    });
    expect(commands.some((c) => c.id === 'settings')).toBe(true);
    expect(commands.some((c) => c.section === 'Session')).toBe(false);
    expect(commands.some((c) => c.id === 'toggle-bottom')).toBe(true);
  });
});

describe('toggle-ui-mode command', () => {
  const baseDeps = {
    agentCatalog: { agents: [], report: { errors: [] } },
    sessions: [],
    selected: null,
    onNewAgent: () => {},
    onSelectSession: () => {},
    onToggleBottom: () => {},
    onToggleSidebar: () => {},
    onToggleRightRail: () => {},
    onOpenSettings: () => {},
    onFocusComposer: () => {},
    onSwitchAgentTab: () => {},
    onSwitchTerminalTab: () => {},
  };

  it('is labelled by the current mode and runs the toggle', () => {
    let toggled = 0;
    const agent = createCommandRegistry();
    registerSessionCommands(agent, { ...baseDeps, uiMode: 'agent', onToggleUiMode: () => toggled++ });
    const cmd = agent.list().find((c) => c.id === 'toggle-ui-mode');
    expect(cmd?.label).toBe('Switch to IDE mode');
    expect(cmd?.section).toBe('View');
    cmd?.run();
    expect(toggled).toBe(1);

    const ide = createCommandRegistry();
    registerSessionCommands(ide, { ...baseDeps, uiMode: 'ide', onToggleUiMode: () => {} });
    expect(ide.list().find((c) => c.id === 'toggle-ui-mode')?.label).toBe('Switch to Agent mode');
  });

  it('is absent without a handler', () => {
    const r = createCommandRegistry();
    registerSessionCommands(r, baseDeps);
    expect(r.list().some((c) => c.id === 'toggle-ui-mode')).toBe(false);
  });
});

describe('isSessionReverted', () => {
  it('reads reverted flag', () => {
    const session: ShellSession = {
      id: 's',
      paneId: 'p',
      title: 't',
      agentLabel: 'a',
      agentFamily: 'other',
      status: 'idle',
      updatedAt: 0,
      unread: false,
      reverted: true,
    };
    expect(isSessionReverted(session)).toBe(true);
  });
});
