import {
  agentTuiSurfaceTopPx,
  terminalSurfaceTopPx,
} from '../lib/shell-pane-chrome';
import type { AgentCatalog } from '@loomria/shared';
import type { PaneRegistryApi } from '../hooks/usePaneRegistry';
import type { SessionRailState } from '../hooks/useSessionRail';
import type { BottomPanelTab } from '../lib/shell-selection-context';
import { mergePaneAndSessionStatus } from '../lib/display-status';
import { isAgentSessionPane, isUserShellPane } from '../lib/pane-surface';
import { AgentTuiHeader, AgentTuiPlaceholder } from './agent/AgentTuiColumn';
import { TerminalPane } from './TerminalPane';

interface Props {
  bottomTab: BottomPanelTab;
  agentPaneId: string | null;
  selectedTerminalPaneId: string | null;
  showTui: boolean;
  chatWidthPercent?: number;
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
  bottomTab,
  agentPaneId,
  selectedTerminalPaneId,
  showTui,
  chatWidthPercent,
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
  const { paneList, replacePaneAgent } = registry;
  const panes = paneList.filter((pane) => !pane.info.id.startsWith('loomria-orchestrator-'));
  const agentTuiOpen =
    bottomTab === 'agent' && showTui && Boolean(agentPaneId);

  return (
    <div
      className="absolute inset-0 overflow-visible pointer-events-none z-[5]"
      data-agent-tui-layout={agentTuiOpen ? 'open' : 'parked'}
    >
      {panes.map((pane) => {
        const isSelectedAgent = pane.info.id === agentPaneId;
        const isSelectedTerminal = pane.info.id === selectedTerminalPaneId;
        const isAgentPane = isAgentSessionPane(pane.info.agent_type);
        const isShellPane = isUserShellPane(pane.info.agent_type);

        const agentTuiVisible =
          isAgentPane &&
          bottomTab === 'agent' &&
          isSelectedAgent &&
          showTui;

        const terminalTabVisible =
          isShellPane && bottomTab === 'terminal' && isSelectedTerminal;

        const visibleInLayout = agentTuiVisible || terminalTabVisible;
        const hidden = !visibleInLayout;

        const session = sessionStates.get(pane.info.id);
        const displayStatus = mergePaneAndSessionStatus(pane.status, session?.state);

        const visibleStyle = agentTuiVisible
          ? {
              left: `${chatWidthPercent ?? 40}%`,
              right: 0,
              top: agentTuiSurfaceTopPx(),
              bottom: 0,
            }
          : terminalTabVisible
            ? { left: 0, right: 0, top: terminalSurfaceTopPx(), bottom: 0 }
            : { left: 0, right: 0, top: 0, bottom: 0 };

        const surfaceClass = hidden
          ? 'lr-pane-surface lr-pane-surface--parked absolute -left-[10000px] w-[480px] h-[320px] opacity-0 pointer-events-none overflow-hidden flex flex-col'
          : 'lr-pane-surface lr-pane-surface--agent-tui absolute overflow-hidden flex flex-col bg-canvas pointer-events-auto z-[6]';

        const isHeadless = pane.info.surface === 'headless';
        if (isHeadless && hidden) {
          return (
            <div key={pane.info.id} className={surfaceClass} data-pane-id={pane.info.id}>
              <div className="flex-1 min-h-0" />
            </div>
          );
        }

        return (
          <div
            key={pane.info.id}
            className={surfaceClass}
            style={hidden ? undefined : visibleStyle}
            data-pane-id={pane.info.id}
            data-surface-visible={visibleInLayout ? '1' : '0'}
            data-pane-surface-host={visibleInLayout ? '1' : '0'}
          >
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
                compactChrome={agentTuiVisible || terminalTabVisible}
                reflowKey={`${layoutEpoch}-${bottomTab}-${agentTuiVisible ? 'tui-open' : terminalTabVisible ? 'terminal' : 'parked'}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
