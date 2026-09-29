import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentCatalog, AgentId } from '@loomria/shared';
import { listLaunchPresets } from '@loomria/shared';
import { AgentView } from '../agent/AgentView';
import { PersistentPaneSurfaces } from '../PersistentPaneSurfaces';
import { SettingsPanel } from '../SettingsPanel';
import type { PaneRegistryApi } from '../../hooks/usePaneRegistry';
import type { SessionRailState } from '../../hooks/useSessionRail';
import { useAgentChatSplit } from '../../hooks/useAgentChatSplit';
import { useShellLayout } from '../../hooks/useShellLayout';
import { useShellKeyboard } from '../../hooks/useShellKeyboard';
import { buildPaneDisplayNames } from '../../lib/pane-display-name';
import { isUserShellPane } from '../../lib/pane-surface';
import { useSessionList } from '../../lib/shell-data';
import { ShellSelectionProvider, useShellSelection } from '../../lib/shell-selection-context';
import { isTauriRuntime } from '../../lib/is-tauri';
import { readDemoUrlFlags } from '../../lib/demo-mode';
import { useDemoFixtures } from '../../lib/demo/DemoContext';
import { isSessionMuted } from '../../lib/session-notify-prefs';
import { ActivityRail } from './ActivityRail';
import { BottomPanel } from './BottomPanel';
import { buildPaletteCommands, CommandPalette } from './CommandPalette';
import { ExplorerPanel } from './ExplorerPanel';
import { MainLauncher } from './MainLauncher';
import { ResizableSplitter } from './ResizableSplitter';
import { RightRail } from './RightRail';
import { ShellTitleBar, EditorTabsSlot } from './ShellTitleBar';
import { SidebarPanel } from './SidebarPanel';

export type AppShellProps = {
  agentCatalog: AgentCatalog;
  registry: PaneRegistryApi;
  sessionStates: Map<string, SessionRailState>;
  projectPath: string | null;
  onProjectPathChange: (path: string) => Promise<void>;
  railConnecting: boolean;
  selectedPaneId: string | null;
  setSelectedPaneId: (id: string | null) => void;
  showTui: boolean;
  setShowTui: (value: boolean | ((prev: boolean) => boolean)) => void;
  onNewSession: (agent: AgentId) => void | Promise<void>;
  onClosePane: (paneId: string) => void;
  onJumpApproval: (paneId: string) => void;
};

function AppShellInner({
  agentCatalog,
  registry,
  sessionStates,
  projectPath,
  onProjectPathChange,
  railConnecting,
  selectedPaneId,
  setSelectedPaneId,
  showTui,
  setShowTui,
  onNewSession,
  onClosePane,
  onJumpApproval,
}: AppShellProps) {
  const demo = useDemoFixtures();
  const shell = useShellSelection();
  const { layout, patchLayout, resetPanel } = useShellLayout();

  useEffect(() => {
    if (!demo) return;
    const flags = readDemoUrlFlags();
    if (flags.palette) shell.setPaletteOpen(true);
    if (flags.collapsed) {
      patchLayout({ sidebarCollapsed: true, rightRailCollapsed: true });
    }
    if (flags.bottomTab === 'terminal') shell.setBottomTab('terminal');
  }, [demo, patchLayout, shell]);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [mutedMap, setMutedMap] = useState<Record<string, boolean>>({});
  const [newPaneOpen, setNewPaneOpen] = useState(false);
  const dragBase = useRef(0);

  const panes = registry.paneList.filter((p) => !p.info.id.startsWith('loomria-orchestrator-'));
  const paneTitles = useMemo(
    () => buildPaneDisplayNames(panes, agentCatalog),
    [agentCatalog, panes],
  );

  const shellSessions = useSessionList();

  const terminalPanes = useMemo(
    () => panes.filter((p) => isUserShellPane(p.info.agent_type)),
    [panes],
  );

  useEffect(() => {
    if (terminalPanes.length === 0) return;
    if (
      !shell.selectedTerminalPaneId ||
      !terminalPanes.some((p) => p.info.id === shell.selectedTerminalPaneId)
    ) {
      shell.setSelectedTerminalPaneId(terminalPanes[0].info.id);
    }
  }, [shell, terminalPanes]);

  useEffect(() => {
    if (!selectedPaneId && shellSessions[0]) {
      setSelectedPaneId(shellSessions[0].paneId);
    }
  }, [selectedPaneId, setSelectedPaneId, shellSessions]);

  useEffect(() => {
    if (!selectedPaneId) return;
    void isSessionMuted(selectedPaneId).then((muted) => {
      setMutedMap((prev) => ({ ...prev, [selectedPaneId]: muted }));
    });
  }, [selectedPaneId]);

  useEffect(() => {
    setLayoutEpoch((n) => n + 1);
  }, [
    layout,
    shell.bottomTab,
    showTui,
    selectedPaneId,
    shell.selectedTerminalPaneId,
  ]);

  const selectedPane = panes.find((p) => p.info.id === selectedPaneId);
  const sessionForAgent = selectedPaneId ? sessionStates.get(selectedPaneId) : undefined;
  const agentPaneTitle = selectedPaneId ? (paneTitles.get(selectedPaneId) ?? null) : null;
  const tuiSurfaceLive = isTauriRuntime() && Boolean(selectedPane && selectedPane.status !== 'error');

  const agentSplitActive = shell.bottomTab === 'agent' && Boolean(selectedPaneId) && showTui;
  const { chatPercent, startDrag } = useAgentChatSplit(agentSplitActive);

  const toggleBottom = useCallback(() => {
    patchLayout({ bottomPanelCollapsed: !layout.bottomPanelCollapsed });
  }, [layout.bottomPanelCollapsed, patchLayout]);

  const toggleSidebar = useCallback(() => {
    patchLayout({ sidebarCollapsed: !layout.sidebarCollapsed });
  }, [layout.sidebarCollapsed, patchLayout]);

  const toggleRightRail = useCallback(() => {
    patchLayout({ rightRailCollapsed: !layout.rightRailCollapsed });
  }, [layout.rightRailCollapsed, patchLayout]);

  const paletteCommands = useMemo(
    () =>
      buildPaletteCommands({
        agentCatalog,
        sessions: shellSessions,
        onNewAgent: () => setNewPaneOpen(true),
        onSelectSession: (id) => {
          setSelectedPaneId(id);
          shell.setBottomTab('agent');
        },
        onToggleBottom: toggleBottom,
        onToggleSidebar: toggleSidebar,
        onToggleRightRail: toggleRightRail,
        onOpenSettings: () => shell.setSettingsOpen(true),
        onFocusComposer: () => {
          shell.setBottomTab('agent');
          document.querySelector<HTMLElement>('[data-agent-composer]')?.focus();
        },
        onSwitchAgentTab: () => shell.setBottomTab('agent'),
        onSwitchTerminalTab: () => shell.setBottomTab('terminal'),
      }),
    [
      agentCatalog,
      shell,
      shellSessions,
      setSelectedPaneId,
      toggleBottom,
      toggleRightRail,
      toggleSidebar,
    ],
  );

  useShellKeyboard({
    sessionStates,
    agentPaneId: selectedPaneId,
    onNewAgent: () => setNewPaneOpen(true),
    onToggleBottom: toggleBottom,
    onToggleSidebar: toggleSidebar,
    onOpenPalette: () => {
      shell.setPaletteFileMode(false);
      shell.setPaletteOpen(true);
    },
    onOpenFilePalette: () => {
      shell.setPaletteFileMode(true);
      shell.setPaletteOpen(true);
    },
    onSwitchTerminalTab: () => shell.setBottomTab('terminal'),
    onJumpApproval,
    onApproveTop: () => {},
    onDenyTop: () => {},
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-canvas text-text" data-testid="app-shell">
      <ShellTitleBar onNewPane={() => setNewPaneOpen(true)} />
      <div className="flex flex-1 min-h-0">
        <ActivityRail
          section={shell.railSection}
          onSectionChange={shell.setRailSection}
          onOpenSettings={() => shell.setSettingsOpen(true)}
        />
        {!layout.sidebarCollapsed && (
          <>
            <div style={{ width: layout.sidebarWidth }} className="shrink-0 min-h-0 flex flex-col">
              <SidebarPanel
                section={shell.railSection}
                sessionStates={sessionStates}
                agentCatalog={agentCatalog}
                paneTitles={paneTitles}
                selectedPaneId={selectedPaneId}
                connecting={railConnecting}
                onSelectSession={(id) => {
                  setSelectedPaneId(id);
                  shell.setBottomTab('agent');
                }}
                projectPath={projectPath}
                onProjectPathChange={onProjectPathChange}
              />
            </div>
            <ResizableSplitter
              axis="horizontal"
              data-testid="splitter-sidebar"
              onDragStart={() => {
                dragBase.current = layout.sidebarWidth;
              }}
              onDrag={(delta) =>
                patchLayout({ sidebarWidth: Math.round(dragBase.current + delta) })
              }
              onDoubleClick={() => resetPanel('sidebarWidth')}
            />
          </>
        )}
        {!layout.explorerCollapsed && (
          <>
            <div style={{ width: layout.explorerWidth }} className="shrink-0 min-h-0">
              <ExplorerPanel />
            </div>
            <ResizableSplitter
              axis="horizontal"
              data-testid="splitter-explorer"
              onDragStart={() => {
                dragBase.current = layout.explorerWidth;
              }}
              onDrag={(delta) =>
                patchLayout({ explorerWidth: Math.round(dragBase.current + delta) })
              }
              onDoubleClick={() => resetPanel('explorerWidth')}
            />
          </>
        )}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <EditorTabsSlot />
          <div className="flex-1 min-h-0 relative">
            <MainLauncher />
          </div>
          {!layout.bottomPanelCollapsed && (
            <>
              <ResizableSplitter
                axis="vertical"
                data-testid="splitter-bottom"
                onDragStart={() => {
                  dragBase.current = layout.bottomPanelPercent;
                }}
                onDrag={(delta) => {
                  const el = document.querySelector('[data-testid="app-shell"]');
                  const h = el?.clientHeight ?? 800;
                  const next = dragBase.current - (delta / h) * 100;
                  patchLayout({ bottomPanelPercent: Math.min(80, Math.max(20, next)) });
                }}
                onDoubleClick={() => resetPanel('bottomPanelPercent')}
              />
              <div
                className="min-h-0 shrink-0 flex flex-col relative"
                style={{ flex: `0 0 ${layout.bottomPanelPercent}%` }}
                data-testid="bottom-panel-host"
              >
                <BottomPanel
                  tab={shell.bottomTab}
                  onTabChange={shell.setBottomTab}
                  agentContent={
                    selectedPaneId ? (
                      <div className="relative flex flex-1 min-h-0 flex-row">
                        <AgentView
                          embedded
                          paneId={selectedPaneId}
                          agentCatalog={agentCatalog}
                          paneStatus={selectedPane?.status}
                          sessionState={sessionForAgent ?? null}
                          paneTitle={agentPaneTitle}
                          headlessClaude={
                            selectedPane?.info.surface === 'headless' &&
                            selectedPane?.info.agent_type === 'claude'
                          }
                          showTui={showTui}
                          chatWidthPercent={showTui ? chatPercent : undefined}
                          onToggleTui={() => setShowTui((v) => !v)}
                          onExitWorkspace={() => setShowTui(false)}
                          muted={Boolean(mutedMap[selectedPaneId])}
                          onMutedChange={(muted) =>
                            setMutedMap((prev) => ({ ...prev, [selectedPaneId]: muted }))
                          }
                        />
                        {showTui && (
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            className="w-px shrink-0 bg-border-subtle hover:bg-accent/50 cursor-col-resize touch-none z-[2] pointer-events-auto"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              startDrag();
                            }}
                          />
                        )}
                      </div>
                    ) : (
                      <p className="p-4 text-meta text-text-3">Select a session to chat.</p>
                    )
                  }
                  terminalContent={
                    terminalPanes.length === 0 ? (
                      <p className="p-4 text-meta text-text-3">No terminal panes yet.</p>
                    ) : (
                      <div className="flex-1 min-h-0" />
                    )
                  }
                />
                <PersistentPaneSurfaces
                  bottomTab={shell.bottomTab}
                  agentPaneId={selectedPaneId}
                  selectedTerminalPaneId={shell.selectedTerminalPaneId}
                  showTui={showTui}
                  chatWidthPercent={showTui ? chatPercent : undefined}
                  layoutEpoch={layoutEpoch}
                  agentCatalog={agentCatalog}
                  registry={registry}
                  projectPath={projectPath}
                  sessionStates={sessionStates}
                  agentPaneTitle={agentPaneTitle}
                  tuiSurfaceLive={tuiSurfaceLive}
                  onHideTui={() => setShowTui(false)}
                  onClosePane={onClosePane}
                  onEnterAgent={(id) => setSelectedPaneId(id)}
                />
              </div>
            </>
          )}
        </div>
        {!layout.rightRailCollapsed && (
          <>
            <ResizableSplitter
              axis="horizontal"
              data-testid="splitter-right"
              onDragStart={() => {
                dragBase.current = layout.rightRailWidth;
              }}
              onDrag={(delta) =>
                patchLayout({ rightRailWidth: Math.round(dragBase.current - delta) })
              }
              onDoubleClick={() => resetPanel('rightRailWidth')}
            />
            <div style={{ width: layout.rightRailWidth }} className="shrink-0 min-h-0">
              <RightRail />
            </div>
          </>
        )}
      </div>

      {newPaneOpen && (
        <NewPaneMenu
          agentCatalog={agentCatalog}
          onPick={(agent) => {
            setNewPaneOpen(false);
            void onNewSession(agent);
          }}
          onClose={() => setNewPaneOpen(false)}
        />
      )}

      <CommandPalette
        open={shell.paletteOpen}
        fileMode={shell.paletteFileMode}
        onClose={() => shell.setPaletteOpen(false)}
        commands={paletteCommands}
      />

      <SettingsPanel
        open={shell.settingsOpen}
        onClose={() => shell.setSettingsOpen(false)}
        projectPath={projectPath}
        onProjectPathChange={onProjectPathChange}
      />
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  const [bottomTab, setBottomTab] = useState<'agent' | 'terminal'>('agent');
  const [railSection, setRailSection] = useState<'sessions' | 'workspaces'>('sessions');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteFileMode, setPaletteFileMode] = useState(false);
  const [selectedTerminalPaneId, setSelectedTerminalPaneId] = useState<string | null>(null);

  const selection = useMemo(
    () => ({
      selectedPaneId: props.selectedPaneId,
      setSelectedPaneId: props.setSelectedPaneId,
      bottomTab,
      setBottomTab,
      showTui: props.showTui,
      setShowTui: props.setShowTui,
      selectedTerminalPaneId,
      setSelectedTerminalPaneId,
      railSection,
      setRailSection,
      settingsOpen,
      setSettingsOpen,
      paletteOpen,
      setPaletteOpen,
      paletteFileMode,
      setPaletteFileMode,
    }),
    [
      bottomTab,
      paletteFileMode,
      paletteOpen,
      props.selectedPaneId,
      props.setSelectedPaneId,
      props.showTui,
      props.setShowTui,
      railSection,
      selectedTerminalPaneId,
      settingsOpen,
    ],
  );

  return (
    <ShellSelectionProvider value={selection}>
      <AppShellInner {...props} />
    </ShellSelectionProvider>
  );
}

function NewPaneMenu({
  agentCatalog,
  onPick,
  onClose,
}: {
  agentCatalog: AgentCatalog;
  onPick: (agent: AgentId) => void;
  onClose: () => void;
}) {
  const presets = listLaunchPresets(agentCatalog);
  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center pt-16 bg-canvas/60"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-56 rounded-lg border border-border bg-elevated shadow-xl py-1">
        {presets.map((p) => (
          <button
            key={p.type}
            type="button"
            className="w-full text-left px-3 py-2 text-body hover:bg-hover"
            onClick={() => onPick(p.type)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
