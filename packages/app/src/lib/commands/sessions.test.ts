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

describe('isSessionReverted', () => {
  it('reads reverted flag', () => {
    const session: ShellSession = {
      id: 's',
      paneId: 'p',
      title: 't',
      agentLabel: 'a',
      status: 'idle',
      updatedAt: 0,
      unread: false,
      reverted: true,
    };
    expect(isSessionReverted(session)).toBe(true);
  });
});
