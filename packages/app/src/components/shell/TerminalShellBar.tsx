import { Plus, X } from 'lucide-react';
import type { PaneData } from '../../hooks/usePaneRegistry';
import { getPreset, type AgentCatalog } from '@loomria/shared';

export function TerminalShellBar({
  agentCatalog,
  terminalPanes,
  selectedPaneId,
  onSelect,
  onNewShell,
  onCloseShell,
}: {
  agentCatalog: AgentCatalog;
  terminalPanes: PaneData[];
  selectedPaneId: string | null;
  onSelect: (paneId: string) => void;
  onNewShell: () => void;
  onCloseShell: (paneId: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 px-2 h-7 shrink-0 border-b border-border-subtle bg-surface z-[30] relative pointer-events-auto"
      data-testid="terminal-shell-bar"
    >
      {terminalPanes.map((pane) => {
        const label =
          getPreset(agentCatalog, pane.info.agent_type as never)?.label ?? pane.info.agent_type;
        const active = pane.info.id === selectedPaneId;
        return (
          <div
            key={pane.info.id}
            className={`flex items-center h-6 rounded-sm text-meta max-w-[9rem] transition-colors duration-ui ${
              active ? 'bg-elevated text-text' : 'text-text-3 hover:text-text-2 hover:bg-hover'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(pane.info.id)}
              className="h-6 px-2 truncate max-w-[7rem]"
            >
              {label}
            </button>
            <button
              type="button"
              aria-label={`Close ${label}`}
              className="h-6 w-5 flex items-center justify-center shrink-0 hover:text-status-error"
              onClick={() => onCloseShell(pane.info.id)}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
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
