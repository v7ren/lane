import { useEffect, useMemo, useRef, useState } from 'react';
import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';
import type { ShellSession } from '../../lib/shell-data';

export type PaletteCommand = {
  id: string;
  label: string;
  section: string;
  keywords?: string;
  run: () => void;
};

export function filterPaletteCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;
  return commands.filter((cmd) => {
    const hay = `${cmd.label} ${cmd.section} ${cmd.keywords ?? ''}`.toLowerCase();
    return hay.includes(q);
  });
}

export function CommandPalette({
  open,
  fileMode,
  onClose,
  commands,
}: {
  open: boolean;
  fileMode: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, fileMode]);

  const filtered = useMemo(() => {
    const base = fileMode
      ? [
          {
            id: 'file-phase5',
            label: 'File search — coming in Phase 5',
            section: 'Files',
            run: onClose,
          },
          ...commands,
        ]
      : commands;
    return filterPaletteCommands(base, query);
  }, [commands, fileMode, onClose, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] bg-canvas/70 backdrop-blur-[2px]"
      data-testid="command-palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-elevated shadow-2xl overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={fileMode ? 'Search files…' : 'Type a command…'}
          className="w-full px-3 py-2.5 text-body bg-transparent border-b border-border-subtle outline-none text-text placeholder:text-text-3"
          data-testid="command-palette-input"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-meta text-text-3">No matches</li>
          )}
          {filtered.map((cmd) => (
            <li key={cmd.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-hover transition-colors duration-ui flex items-center justify-between gap-2"
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
              >
                <span className="text-body text-text">{cmd.label}</span>
                <span className="text-meta text-text-3 uppercase tracking-wide">{cmd.section}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function buildPaletteCommands({
  agentCatalog,
  sessions,
  onNewAgent,
  onSelectSession,
  onToggleBottom,
  onToggleSidebar,
  onToggleRightRail,
  onOpenSettings,
  onFocusComposer,
  onSwitchAgentTab,
  onSwitchTerminalTab,
}: {
  agentCatalog: AgentCatalog;
  sessions: ShellSession[];
  onNewAgent: (agent: AgentId) => void;
  onSelectSession: (paneId: string) => void;
  onToggleBottom: () => void;
  onToggleSidebar: () => void;
  onToggleRightRail: () => void;
  onOpenSettings: () => void;
  onFocusComposer: () => void;
  onSwitchAgentTab: () => void;
  onSwitchTerminalTab: () => void;
}): PaletteCommand[] {
  const agents = listLaunchPresets(agentCatalog);
  const agentCommands: PaletteCommand[] = agents.map((preset) => ({
    id: `new-${preset.type}`,
    label: `New agent: ${preset.label}`,
    section: 'Agent',
    keywords: preset.type,
    run: () => onNewAgent(preset.type),
  }));

  const sessionCommands: PaletteCommand[] = sessions.map((s) => ({
    id: `session-${s.paneId}`,
    label: `Switch session: ${s.title}`,
    section: 'Session',
    keywords: s.agentLabel,
    run: () => onSelectSession(s.paneId),
  }));

  return [
    ...agentCommands,
    ...sessionCommands,
    {
      id: 'toggle-bottom',
      label: 'Toggle bottom panel',
      section: 'View',
      run: onToggleBottom,
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle sidebar',
      section: 'View',
      run: onToggleSidebar,
    },
    {
      id: 'toggle-right',
      label: 'Toggle right rail',
      section: 'View',
      run: onToggleRightRail,
    },
    {
      id: 'focus-composer',
      label: 'Focus composer',
      section: 'Agent',
      run: onFocusComposer,
    },
    {
      id: 'tab-agent',
      label: 'Show AGENT tab',
      section: 'Panel',
      run: onSwitchAgentTab,
    },
    {
      id: 'tab-terminal',
      label: 'Show TERMINAL tab',
      section: 'Panel',
      run: onSwitchTerminalTab,
    },
    {
      id: 'settings',
      label: 'Open settings',
      section: 'Settings',
      run: onOpenSettings,
    },
  ];
}
