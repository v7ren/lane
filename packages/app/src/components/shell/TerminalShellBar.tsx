import { Plus } from 'lucide-react';
import type { PaneData } from '../../hooks/usePaneRegistry';
import { getPreset, type AgentCatalog } from '@loomria/shared';

export function TerminalShellBar({
  agentCatalog,
  terminalPanes,
  selectedPaneId,
  onSelect,
  onNewShell,
}: {
  agentCatalog: AgentCatalog;
  terminalPanes: PaneData[];
  selectedPaneId: string | null;
  onSelect: (paneId: string) => void;
  onNewShell: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 h-7 shrink-0 border-b border-border-subtle bg-surface z-10 relative"
      data-testid="terminal-shell-bar"
    >
      {terminalPanes.map((pane) => {
        const label =
          getPreset(agentCatalog, pane.info.agent_type as never)?.label ?? pane.info.agent_type;
        const active = pane.info.id === selectedPaneId;
        return (
          <button
            key={pane.info.id}
            type="button"
            onClick={() => onSelect(pane.info.id)}
            className={`h-6 px-2 rounded-sm text-meta truncate max-w-[8rem] transition-colors duration-ui ${
              active ? 'bg-elevated text-text' : 'text-text-3 hover:text-text-2 hover:bg-hover'
            }`}
          >
            {label}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="New shell"
        onClick={onNewShell}
        className="h-6 w-6 flex items-center justify-center rounded-sm text-text-3 hover:text-text hover:bg-hover"
      >
        <Plus size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}
