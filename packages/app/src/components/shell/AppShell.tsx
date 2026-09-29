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
import { filterAgentSessionStates } from '../../lib/agent-session-states';
import {
  defaultBottomRatio,
  readBottomRatioUserTouched,
} from '../../lib/shell-layout';
import { ActivityRail } from './ActivityRail';
import { AgentPanelEmpty } from './AgentPanelEmpty';
import { BottomPanel } from './BottomPanel';
import { buildPaletteCommands, CommandPalette } from './CommandPalette';
import { ExplorerPanel } from './ExplorerPanel';
import { MainLauncher } from './MainLauncher';
import { TerminalShellBar } from './TerminalShellBar';
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
  const { layout, patchLayout, resetPanel, resetVisibility, markBottomPanelResized } =
    useShellLayout();
  const hasEditorTabs = false;
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    resetVisibility();
  }, [resetVisibility]);

  useEffect(() => {
    if (readBottomRatioUserTouched()) return;
    patchLayout({ bottomPanelPercent: defaultBottomRatio({ hasEditorTabs }) });
  }, [hasEditorTabs, patchLayout]);

  useEffect(() => {
    if (!demo) return;
    const flags = readDemoUrlFlags();
    if (flags.palette) shell.setPaletteOpen(true);
    if (flags.collapsed) {
      shell.setSidebarColumnOpen(false);
      shell.setRightRailOpen(false);
    } else {
      shell.setSidebarColumnOpen(true);
      shell.setRightRailOpen(true);
    }
    if (flags.bottomTab === 'terminal') shell.setBottomTab('terminal');
    // Demo URL flags apply once per variant load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo?.variant]);

  const agentSessionStates = useMemo(
    () => filterAgentSessionStates(sessionStates),
    [sessionStates],
  );

  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [mutedMap, setMutedMap] = useState<Record<string, boolean>>({});
  const [newPaneOpen, setNewPaneOpen] = useState(false);
  const dragBase = useRef(0);

  const panes = registry.paneList.filter((p) => !p.info.id.startsWith('loomria-orchestrator-'));
  const paneCwds = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of panes) m.set(p.info.id, p.info.cwd);
    return m;
  }, [panes]);
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
    if (demo?.variant === 'empty') return;
    if (!selectedPaneId && shellSessions[0]) {
      setSelectedPaneId(shellSessions[0].paneId);
    }
  }, [demo?.variant, selectedPaneId, setSelectedPaneId, shellSessions]);

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
    shell.setSidebarColumnOpen((open) => !open);
  }, [shell]);

  const toggleRightRail = useCallback(() => {
    shell.setRightRailOpen((open) => !open);
  }, [shell]);

  const handleRailSection = useCallback(
    (section: 'sessions' | 'workspaces') => {
      if (section === shell.railSection) {
        shell.setSidebarColumnOpen((open) => !open);
      } else {
        shell.setRailSection(section);
        shell.setSidebarColumnOpen(true);
      }
    },
    [shell],
  );

  const showSidebarColumn = shell.sidebarColumnOpen;
  const showRightRail = viewportWidth >= 1100 || shell.rightRailOpen;

  const handleNewShell = useCallback(async () => {
    const id = await registry.spawnPane({
      agent_type: 'powershell',
      cwd: projectPath ?? undefined,
    });
    if (id) {
      shell.setSelectedTerminalPaneId(id);
      shell.setBottomTab('terminal');
    }
  }, [projectPath, registry, shell]);

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
      <ShellTitleBar
        onNewPane={() => setNewPaneOpen(true)}
        showRightRailToggle={viewportWidth < 1100}
        onToggleRightRail={toggleRightRail}
      />
      <div className="flex flex-1 min-h-0">
        <ActivityRail
          section={shell.railSection}
          onSectionChange={handleRailSection}
          onOpenSettings={() => shell.setSettingsOpen(true)}
        />
        {showSidebarColumn && (
          <>
            <div
              style={{ width: layout.sidebarWidth }}
              className="shrink-0 min-h-0 flex flex-col border-r border-border-subtle"
              data-testid="sidebar-column"
            >
              <SidebarPanel
                section={shell.railSection}
                sessionStates={agentSessionStates}
                agentCatalog={agentCatalog}
                paneTitles={paneTitles}
                paneCwds={paneCwds}
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
            <div
              style={{ width: layout.explorerWidth }}
              className="shrink-0 min-h-0 border-r border-border-subtle"
            >
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
            <MainLauncher
              onNewAgent={() => setNewPaneOpen(true)}
              onTogglePanel={toggleBottom}
              onSearchFiles={() => {
                shell.setPaletteFileMode(true);
                shell.setPaletteOpen(true);
              }}
              onCommandPalette={() => {
                shell.setPaletteFileMode(false);
                shell.setPaletteOpen(true);
              }}
            />
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
                  markBottomPanelResized();
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
                  overlay={
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
                  }
                  agentContent={
                    selectedPaneId ? (
                      <div className="relative flex flex-1 min-h-0 flex-row z-[1]">
                        <AgentView
                          embedded
                          paneId={selectedPaneId}
                          agentCatalog={agentCatalog}
                          paneStatus={selectedPane?.status}
                          sessionState={sessionForAgent ?? null}
                          paneTitle={agentPaneTitle}
                          paneCwd={selectedPane?.info.cwd}
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
                      <AgentPanelEmpty onStartAgent={() => setNewPaneOpen(true)} />
                    )
                  }
                  terminalContent={
                    <>
                      <TerminalShellBar
                        agentCatalog={agentCatalog}
                        terminalPanes={terminalPanes}
                        selectedPaneId={shell.selectedTerminalPaneId}
                        onSelect={(id) => shell.setSelectedTerminalPaneId(id)}
                        onNewShell={() => void handleNewShell()}
                      />
                      <div className="flex-1 min-h-0 relative">
                        {!isTauriRuntime() && (
                          <p
                            className="absolute inset-0 flex items-center justify-center text-meta text-text-3 pointer-events-none z-[4] px-4 text-center"
                            data-testid="terminal-browser-placeholder"
                          >
                            Terminal not connected in browser preview
                          </p>
                        )}
                        {terminalPanes.length === 0 && isTauriRuntime() && (
                          <p className="p-4 text-meta text-text-3">
                            No terminal panes yet. Use + to open a shell.
                          </p>
                        )}
                      </div>
                    </>
                  }
                />
              </div>
            </>
          )}
        </div>
        {showRightRail && (
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
            <div
              style={{ width: layout.rightRailWidth }}
              className="shrink-0 min-h-0 border-l border-border-subtle"
              data-testid="right-rail-column"
            >
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
  const [sidebarColumnOpen, setSidebarColumnOpen] = useState(true);
  const [rightRailOpen, setRightRailOpen] = useState(true);

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
      sidebarColumnOpen,
      setSidebarColumnOpen,
      rightRailOpen,
      setRightRailOpen,
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
      rightRailOpen,
      selectedTerminalPaneId,
      settingsOpen,
      sidebarColumnOpen,
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
