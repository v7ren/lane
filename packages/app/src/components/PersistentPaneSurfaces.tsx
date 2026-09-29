import { useEffect, useState } from 'react';
import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';
import type { AppMode } from '../hooks/useWorkspaceMode';
import type { PaneData, PaneRegistryApi } from '../hooks/usePaneRegistry';
import type { SessionRailState } from '../hooks/useSessionRail';
import { mergePaneAndSessionStatus } from '../lib/display-status';
import { AgentTuiHeader, AgentTuiPlaceholder } from './agent/AgentTuiColumn';
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
  agentPaneTitle: string | null;
  tuiSurfaceLive: boolean;
  onHideTui: () => void;
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
  agentPaneTitle,
  tuiSurfaceLive,
  onHideTui,
  onClosePane,
  onEnterAgent,
}: Props) {
  const { paneList, spawnPane, replacePaneAgent } = registry;
  const panes = paneList.filter((pane) => !pane.info.id.startsWith('loomria-orchestrator-'));
  const [showAdd, setShowAdd] = useState(false);

  const agentTuiColumnOpen = mode === 'agent' && showTui;
  const rootLayoutClass =
    mode === 'workspace'
      ? 'grid grid-cols-1 xl:grid-cols-2 gap-2 auto-rows-[minmax(260px,auto)] p-2'
      : agentTuiColumnOpen
        ? 'relative flex-1 min-w-0 min-h-0 flex flex-col'
        : 'absolute inset-0 overflow-visible pointer-events-none z-0';

  const addPane = async (agent: AgentId) => {
    setShowAdd(false);
    await spawnPane({ agent_type: agent, cwd: projectPath ?? undefined });
  };

  useEffect(() => {
    if (mode !== 'agent' || !showTui || !agentPaneId) return;
  }, [agentPaneId, mode, showTui, layoutEpoch]);

  return (
    <div
      className={`min-h-0 lr-mode-transition ${mode === 'workspace' ? 'flex-1 overflow-auto bg-lr-bg' : agentTuiColumnOpen ? 'flex-1 overflow-auto bg-lr-bg' : ''} ${rootLayoutClass}`}
      data-mode={mode}
      data-agent-tui-layout={mode === 'agent' ? (agentTuiColumnOpen ? 'open' : 'parked') : undefined}
    >
      {panes.map((pane) => {
        const isSelected = pane.info.id === agentPaneId;
        const hiddenInAgent = mode === 'agent' && (!isSelected || !showTui);
        const session = sessionStates.get(pane.info.id);
        const displayStatus = mergePaneAndSessionStatus(pane.status, session?.state);
        const agentTuiVisible = mode === 'agent' && isSelected && showTui;

        let surfaceClass =
          'resize-both min-w-[300px] min-h-[220px] h-[260px] overflow-hidden rounded-lg border border-lr-border/60 lr-pane-surface flex flex-col';
        if (mode === 'agent') {
          if (hiddenInAgent) {
            surfaceClass =
              'lr-pane-surface lr-pane-surface--parked absolute -left-[10000px] w-[480px] h-[320px] opacity-0 pointer-events-none overflow-hidden flex flex-col';
          } else {
            surfaceClass =
              'lr-pane-surface lr-pane-surface--agent-tui flex-1 min-w-0 min-h-0 h-full rounded-none border-0 border-l border-lr-border resize-none overflow-hidden flex flex-col bg-lr-bg';
          }
        }

        return (
          <div key={pane.info.id} className={surfaceClass} data-pane-id={pane.info.id}>
            {agentTuiVisible && (
              <AgentTuiHeader
                agentLabel={agentPaneTitle ?? pane.info.agent_type}
                onHide={onHideTui}
              />
            )}
            <div className="relative flex-1 min-h-0 flex flex-col">
              {agentTuiVisible && !tuiSurfaceLive && <AgentTuiPlaceholder />}
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
                chromeTitle={agentPaneTitle ?? undefined}
                compactChrome={agentTuiVisible}
                reflowKey={`${layoutEpoch}-${mode}-${showTui ? 'tui' : 'chat'}`}
              />
            </div>
          </div>
        );
      })}
      {mode === 'workspace' && panes.length > 0 && (
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
