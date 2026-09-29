import { useEffect, useMemo, useState } from 'react';
import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';
import type { AppMode } from '../hooks/useWorkspaceMode';
import type { PaneData, PaneRegistryApi } from '../hooks/usePaneRegistry';
import type { SessionRailState } from '../hooks/useSessionRail';
import { mergePaneAndSessionStatus } from '../lib/display-status';
import { TerminalPane } from './TerminalPane';

interface Props {
  mode: AppMode;
  agentPaneId: string | null;
  showTui: boolean;
  layoutEpoch: number;
  agentCatalog: AgentCatalog;
  registry: PaneRegistryApi;
  projectPath: string | null;
  sessionStates: Map<string, SessionRailState>;
  onClosePane: (paneId: string) => void;
  onEnterAgent: (paneId: string) => void;
}

export function PersistentPaneSurfaces({
  mode,
  agentPaneId,
  showTui,
  layoutEpoch,
  agentCatalog,
  registry,
  projectPath,
  sessionStates,
  onClosePane,
  onEnterAgent,
}: Props) {
  const { paneList, spawnPane, replacePaneAgent } = registry;
  const panes = paneList.filter((pane) => !pane.info.id.startsWith('loomria-orchestrator-'));
  const [showAdd, setShowAdd] = useState(false);

  const workspaceGridClass =
    mode === 'workspace'
      ? 'grid grid-cols-1 xl:grid-cols-2 gap-2 auto-rows-[minmax(260px,auto)] p-2'
      : 'relative flex-1 min-h-0';

  const addPane = async (agent: AgentId) => {
    setShowAdd(false);
    await spawnPane({ agent_type: agent, cwd: projectPath ?? undefined });
  };

  const paneStatusMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of panes) m.set(p.info.id, p.status);
    return m;
  }, [panes]);

  useEffect(() => {
    if (mode !== 'agent' || !showTui || !agentPaneId) return;
    // reflow handled via layoutEpoch on TerminalPane
  }, [agentPaneId, mode, showTui, layoutEpoch]);

  return (
    <div
      className={`flex-1 min-h-0 overflow-auto bg-lr-bg lr-mode-transition ${workspaceGridClass}`}
      data-mode={mode}
    >
      {panes.map((pane) => {
        const isSelected = pane.info.id === agentPaneId;
        const hiddenInAgent = mode === 'agent' && (!isSelected || !showTui);
        const session = sessionStates.get(pane.info.id);
        const displayStatus = mergePaneAndSessionStatus(pane.status, session?.state);

        let surfaceClass =
          'resize-both min-w-[300px] min-h-[220px] h-[260px] overflow-hidden rounded-lg border border-lr-border/60 lr-pane-surface';
        if (mode === 'agent') {
          if (hiddenInAgent) {
            surfaceClass =
              'lr-pane-surface lr-pane-surface--parked absolute -left-[10000px] w-[480px] h-[320px] opacity-0 pointer-events-none overflow-hidden';
          } else {
            surfaceClass =
              'lr-pane-surface lr-pane-surface--agent-tui flex-1 min-w-0 min-h-0 h-full rounded-none border-0 resize-none overflow-hidden';
          }
        }

        return (
          <div key={pane.info.id} className={surfaceClass} data-pane-id={pane.info.id}>
            <TerminalPane
              agentCatalog={agentCatalog}
              pane={pane}
              subscribePaneData={registry.subscribePaneData}
              onClose={onClosePane}
              onSwitchAgent={(id, agent) =>
                void replacePaneAgent(id, agent, projectPath ?? undefined)
              }
              onOpenAgent={() => onEnterAgent(pane.info.id)}
              displayStatus={displayStatus}
              compactChrome={mode === 'agent' && isSelected}
              reflowKey={`${layoutEpoch}-${mode}-${showTui ? 'tui' : 'chat'}`}
            />
          </div>
        );
      })}
      {mode === 'workspace' && (
        <div className="relative min-h-[220px]">
          <button
            type="button"
            onClick={() => setShowAdd((s) => !s)}
            className="w-full h-full min-h-[220px] rounded-lg border border-dashed border-lr-border text-lr-muted hover:bg-lr-panel/30 text-sm transition-colors"
          >
            + New pane
          </button>
          {showAdd && (
            <div className="absolute top-full left-0 mt-1 z-10 w-48 rounded-lg border border-lr-border bg-lr-panel shadow-lg">
              {listLaunchPresets(agentCatalog).map((p) => (
                <button
                  key={p.type}
                  type="button"
                  onClick={() => void addPane(p.type)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-lr-border/40"
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
