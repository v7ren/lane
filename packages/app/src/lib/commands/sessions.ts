import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';
import { registerAgentCommands } from './agent';
import { registerEditorCommands, type EditorCommandHandlers } from './editor';
import {
  buildShellCommandRegistry,
  createCommandRegistry,
  type CommandRegistry,
} from './index';
import type { ShellSession } from '../shell-data';

export type SessionCommandDeps = {
  agentCatalog: AgentCatalog;
  sessions: ShellSession[];
  selected: ShellSession | null;
  onNewAgent: (agent: AgentId) => void;
  onSelectSession: (paneId: string, sessionId?: string) => void;
  onToggleBottom: () => void;
  onToggleSidebar: () => void;
  onToggleRightRail: () => void;
  onOpenSettings: () => void;
  onFocusComposer: () => void;
  onSwitchAgentTab: () => void;
  onSwitchTerminalTab: () => void;
  onNewOpenCodeSession?: (paneId: string) => void;
  onRenameSelected?: () => void;
  onDeleteSelected?: () => void;
  onSummarizeSelected?: () => void;
  onShareSelected?: () => void;
  onExportMarkdown?: () => void;
  onUnrevertSelected?: () => void;
  editorHandlers?: EditorCommandHandlers;
};

export function registerSessionCommands(registry: CommandRegistry, deps: SessionCommandDeps): void {
  const agents = listLaunchPresets(deps.agentCatalog);
  for (const preset of agents) {
    registry.register({
      id: `new-${preset.type}`,
      label: `New agent: ${preset.label}`,
      section: 'Agent',
      keywords: preset.type,
      run: () => deps.onNewAgent(preset.type as AgentId),
    });
  }

  for (const s of deps.sessions) {
    registry.register({
      id: `session-${s.paneId}-${s.sessionId ?? s.id}`,
      label: `Switch session: ${s.title}`,
      section: 'Session',
      keywords: `${s.agentLabel} ${s.lastMessagePreview ?? ''}`,
      run: () => deps.onSelectSession(s.paneId, s.sessionId),
    });
  }

  if (deps.selected?.sessionId && deps.onNewOpenCodeSession) {
    registry.register({
      id: 'session-new-opencode',
      label: 'New OpenCode session',
      section: 'Session',
      run: () => deps.onNewOpenCodeSession!(deps.selected!.paneId),
    });
  }

  if (deps.selected?.sessionId && deps.onRenameSelected) {
    registry.register({
      id: 'session-rename',
      label: 'Rename session',
      section: 'Session',
      run: deps.onRenameSelected,
    });
  }

  if (deps.selected?.sessionId && deps.onDeleteSelected) {
    registry.register({
      id: 'session-delete',
      label: 'Delete session…',
      section: 'Session',
      run: deps.onDeleteSelected,
    });
  }

  if (deps.selected?.sessionId && deps.onSummarizeSelected) {
    registry.register({
      id: 'session-summarize',
      label: 'Summarize / compact session',
      section: 'Session',
      run: deps.onSummarizeSelected,
    });
  }

  if (deps.selected?.sessionId && deps.onShareSelected) {
    registry.register({
      id: 'session-share',
      label: 'Share session (OpenCode link)',
      section: 'Session',
      run: deps.onShareSelected,
    });
  }

  if (deps.selected?.sessionId && deps.onExportMarkdown) {
    registry.register({
      id: 'session-export-md',
      label: 'Export transcript (Markdown)',
      section: 'Session',
      run: deps.onExportMarkdown,
    });
  }

  if (deps.selected?.reverted && deps.onUnrevertSelected) {
    registry.register({
      id: 'session-unrevert',
      label: 'Redo reverted messages',
      section: 'Session',
      run: deps.onUnrevertSelected,
    });
  }

  registry.register({
    id: 'toggle-bottom',
    label: 'Toggle bottom panel',
    section: 'View',
    run: deps.onToggleBottom,
  });
  registry.register({
    id: 'toggle-sidebar',
    label: 'Toggle sidebar',
    section: 'View',
    run: deps.onToggleSidebar,
  });
  registry.register({
    id: 'toggle-right',
    label: 'Toggle right rail',
    section: 'View',
    run: deps.onToggleRightRail,
  });
  registry.register({
    id: 'focus-composer',
    label: 'Focus composer',
    section: 'Agent',
    run: deps.onFocusComposer,
  });
  registry.register({
    id: 'tab-agent',
    label: 'Show AGENT tab',
    section: 'Panel',
    run: deps.onSwitchAgentTab,
  });
  registry.register({
    id: 'tab-terminal',
    label: 'Show TERMINAL tab',
    section: 'Panel',
    run: deps.onSwitchTerminalTab,
  });
  registry.register({
    id: 'settings',
    label: 'Open settings',
    section: 'Settings',
    run: deps.onOpenSettings,
  });
}

export function buildPaletteCommands(deps: SessionCommandDeps) {
  const registry = createCommandRegistry();
  return buildShellCommandRegistry({
    registry,
    registerSessionCommands: (r) => registerSessionCommands(r, deps),
    registerAgentCommands,
    registerEditorCommands: (r) => {
      if (deps.editorHandlers) registerEditorCommands(r, deps.editorHandlers);
    },
  });
}
