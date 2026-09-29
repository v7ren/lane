import { useState } from 'react';
import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';
import { TerminalPane } from './TerminalPane';
import type { PaneRegistryApi } from '../hooks/usePaneRegistry';

interface Props {
  agentCatalog: AgentCatalog;
  registry: PaneRegistryApi;
  projectPath: string | null;
  onClosePane: (paneId: string) => void;
  onOpenAgent?: (paneId: string) => void;
}

export function TerminalGrid({
  agentCatalog,
  registry,
  projectPath,
  onClosePane,
  onOpenAgent,
}: Props) {
  const { paneList, spawnPane, replacePaneAgent } = registry;
  const panes = paneList.filter((pane) => !pane.info.id.startsWith('loomria-orchestrator-'));
  const [showAdd, setShowAdd] = useState(false);

  const addPane = async (agent: AgentId) => {
    setShowAdd(false);
    await spawnPane({ agent_type: agent, cwd: projectPath ?? undefined });
  };

  const switchAgent = async (paneId: string, agent: AgentId) => {
    await replacePaneAgent(paneId, agent, projectPath ?? undefined);
  };

  return (
    <main className="flex-1 min-h-0 overflow-auto p-2 bg-pm-bg">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2 auto-rows-[minmax(260px,auto)]">
        {panes.map((pane) => (
          <div
            key={`${pane.info.id}-${pane.info.created_at}`}
            className="resize-both min-w-[300px] min-h-[220px] h-[260px] overflow-hidden rounded border border-pm-border/50"
          >
            <TerminalPane
              agentCatalog={agentCatalog}
              pane={pane}
              subscribePaneData={registry.subscribePaneData}
              onClose={onClosePane}
              onSwitchAgent={switchAgent}
              onOpenAgent={onOpenAgent}
            />
          </div>
        ))}
        <div className="relative min-h-[220px]">
          <button
            type="button"
            onClick={() => setShowAdd((s) => !s)}
            className="w-full h-full min-h-[220px] rounded border border-dashed border-pm-border text-pm-muted hover:bg-pm-panel/30 text-sm"
          >
            + New pane
          </button>
          {showAdd && (
            <div className="absolute top-full left-0 mt-1 z-10 w-48 rounded border border-pm-border bg-pm-panel shadow-lg">
              {listLaunchPresets(agentCatalog).map((p) => (
                <button
                  key={p.type}
                  type="button"
                  onClick={() => void addPane(p.type)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-pm-border/40"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
