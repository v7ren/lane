import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { AgentCatalog, AgentId } from '@loomria/shared';
import type { PaneData } from '../../hooks/usePaneRegistry';
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
import { useSelectedSession, useSessionList } from '../../lib/shell-data';
import { ShellSelectionProvider, useShellSelection } from '../../lib/shell-selection-context';
import { isTauriRuntime } from '../../lib/is-tauri';
import { readDemoUrlFlags } from '../../lib/demo-mode';
import { useDemoFixtures } from '../../lib/demo/DemoContext';
import { isSessionMuted } from '../../lib/session-notify-prefs';
import { filterAgentSessionStates } from '../../lib/agent-session-states';
import { buildPaletteCommands } from '../../lib/commands/sessions';
import { SessionActionsProvider, useSessionActions } from '../../lib/sessions/session-actions-context';
import { ShellToastProvider } from '../../lib/sessions/shell-toast';
import { useOpenCodeTuiSync } from '../../lib/sessions/use-tui-sync';
import { isOpenCodePane } from '../../lib/sessions/merge-sessions';
import { findOpenCodePaneForProject } from '../../lib/sessions/workspace-pane';
import {
  defaultBottomRatio,
  readBottomRatioUserTouched,
} from '../../lib/shell-layout';
import { ActivityRail } from './ActivityRail';
import { AgentPanelEmpty } from './AgentPanelEmpty';
import { BottomPanel } from './BottomPanel';
import { CommandPalette } from './CommandPalette';
import { listLaunchPresets } from '@loomria/shared';
import { ExplorerPanel } from './ExplorerPanel';
import { TerminalShellBar } from './TerminalShellBar';
import { ResizableSplitter } from './ResizableSplitter';
import { RightRail } from './RightRail';
import { ShellTitleBar } from './ShellTitleBar';
import { EditorProvider, useEditor } from '../../lib/editor/EditorContext';
import { EditorWorkspace } from '../editor/EditorWorkspace';
import { SidebarPanel } from './SidebarPanel';
import { RevertBanner } from '../sessions/RevertBanner';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { AnchoredPopover } from './AnchoredPopover';

export type AppShellProps = {
  agentCatalog: AgentCatalog;
  registry: PaneRegistryApi;
  sessionStates: Map<string, SessionRailState>;
  projectPath: string | null;
  onProjectPathChange: (path: string) => Promise<void>;
  railConnecting: boolean;
  selectedPaneId: string | null;
  setSelectedPaneId: (id: string | null) => void;
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;
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
  selectedSessionId,
  setSelectedSessionId,
  showTui,
  setShowTui,
  onNewSession,
  onClosePane,
  onJumpApproval,
}: AppShellProps) {
  const demo = useDemoFixtures();
  const editor = useEditor();
  const shell = useShellSelection();
  const selectedSession = useSelectedSession();
  const { layout, patchLayout, resetPanel, resetVisibility, markBottomPanelResized } =
    useShellLayout();
  const hasEditorTabs = editor.tabs.length > 0;
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const didResetVisibility = useRef(false);
  useEffect(() => {
    if (didResetVisibility.current) return;
    didResetVisibility.current = true;
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
    if (flags.openBottomPanel) patchLayout({ bottomPanelCollapsed: false });
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

  const selectSession = useCallback(
    (paneId: string, sessionId?: string) => {
      setSelectedPaneId(paneId);
      setSelectedSessionId(sessionId ?? null);
      shell.setBottomTab('agent');
    },
    [setSelectedPaneId, setSelectedSessionId, shell],
  );

  useOpenCodeTuiSync(
    selectedPaneId,
    selectedSessionId ?? selectedSession?.sessionId,
    Boolean(selectedPaneId && (selectedSessionId ?? selectedSession?.sessionId)),
  );

  const handleOpenWorkspace = useCallback(
    async (path: string) => {
      await onProjectPathChange(path);
      const existing = findOpenCodePaneForProject(panes, path);
      if (existing) {
        selectSession(existing.info.id, selectedSessionId ?? undefined);
        return;
      }
      const id = await registry.spawnPane({ agent_type: 'opencode_native', cwd: path });
      if (id) selectSession(id);
    },
    [onProjectPathChange, panes, registry, selectSession, selectedSessionId],
  );

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
      selectSession(shellSessions[0].paneId, shellSessions[0].sessionId);
    }
  }, [demo?.variant, selectSession, selectedPaneId, shellSessions]);

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

  return (
    <ShellToastProvider>
      <SessionActionsProvider onSelectSession={selectSession}>
        <AppShellChrome
          agentCatalog={agentCatalog}
          registry={registry}
          sessionStates={sessionStates}
          projectPath={projectPath}
          onProjectPathChange={onProjectPathChange}
          railConnecting={railConnecting}
          selectedPaneId={selectedPaneId}
          selectSession={selectSession}
          handleOpenWorkspace={handleOpenWorkspace}
          showTui={showTui}
          setShowTui={setShowTui}
          onNewSession={onNewSession}
          onClosePane={onClosePane}
          onJumpApproval={onJumpApproval}
          demo={demo}
          shell={shell}
          layout={layout}
          patchLayout={patchLayout}
          resetPanel={resetPanel}
          viewportWidth={viewportWidth}
          panes={panes}
          paneCwds={paneCwds}
          paneTitles={paneTitles}
          shellSessions={shellSessions}
          selectedSession={selectedSession}
          terminalPanes={terminalPanes}
          toggleBottom={toggleBottom}
          toggleSidebar={toggleSidebar}
          toggleRightRail={toggleRightRail}
          handleRailSection={handleRailSection}
          showSidebarColumn={showSidebarColumn}
          showRightRail={showRightRail}
          handleNewShell={handleNewShell}
          selectedPane={selectedPane}
          sessionForAgent={sessionForAgent}
          agentPaneTitle={agentPaneTitle}
          tuiSurfaceLive={tuiSurfaceLive}
          agentSplitActive={agentSplitActive}
          chatPercent={chatPercent}
          startDrag={startDrag}
          mutedMap={mutedMap}
          setMutedMap={setMutedMap}
          newPaneOpen={newPaneOpen}
          setNewPaneOpen={setNewPaneOpen}
          dragBase={dragBase}
          layoutEpoch={layoutEpoch}
          markBottomPanelResized={markBottomPanelResized}
        />
      </SessionActionsProvider>
    </ShellToastProvider>
  );
}

function AppShellChrome(props: {
  agentCatalog: AgentCatalog;
  registry: PaneRegistryApi;
  sessionStates: Map<string, SessionRailState>;
  projectPath: string | null;
  onProjectPathChange: (path: string) => Promise<void>;
  railConnecting: boolean;
  selectedPaneId: string | null;
  selectSession: (paneId: string, sessionId?: string) => void;
  handleOpenWorkspace: (path: string) => Promise<void>;
  showTui: boolean;
  setShowTui: (value: boolean | ((prev: boolean) => boolean)) => void;
  onNewSession: (agent: AgentId) => void | Promise<void>;
  onClosePane: (paneId: string) => void;
  onJumpApproval: (paneId: string) => void;
  demo: ReturnType<typeof useDemoFixtures>;
  shell: ReturnType<typeof useShellSelection>;
  layout: ReturnType<typeof useShellLayout>['layout'];
  patchLayout: ReturnType<typeof useShellLayout>['patchLayout'];
  resetPanel: ReturnType<typeof useShellLayout>['resetPanel'];
  viewportWidth: number;
  panes: PaneData[];
  paneCwds: Map<string, string>;
  paneTitles: Map<string, string>;
  shellSessions: ReturnType<typeof useSessionList>;
  selectedSession: ReturnType<typeof useSelectedSession>;
  terminalPanes: PaneData[];
  toggleBottom: () => void;
  toggleSidebar: () => void;
  toggleRightRail: () => void;
  handleRailSection: (section: 'sessions' | 'workspaces') => void;
  showSidebarColumn: boolean;
  showRightRail: boolean;
  handleNewShell: () => Promise<void>;
  selectedPane: PaneData | undefined;
  sessionForAgent: SessionRailState | undefined;
  agentPaneTitle: string | null;
  tuiSurfaceLive: boolean;
  agentSplitActive: boolean;
  chatPercent: number;
  startDrag: () => void;
  mutedMap: Record<string, boolean>;
  setMutedMap: Dispatch<React.SetStateAction<Record<string, boolean>>>;
  newPaneOpen: boolean;
  setNewPaneOpen: (open: boolean) => void;
  dragBase: MutableRefObject<number>;
  layoutEpoch: number;
  markBottomPanelResized: () => void;
}) {
  const actions = useSessionActions();
  const {
    agentCatalog,
    registry,
    sessionStates,
    projectPath,
    onProjectPathChange,
    railConnecting,
    selectedPaneId,
    selectSession,
    handleOpenWorkspace,
    showTui,
    setShowTui,
    onNewSession,
    onClosePane,
    demo,
    shell,
    layout,
    patchLayout,
    resetPanel,
    viewportWidth,
    panes,
    paneTitles,
    shellSessions,
    selectedSession,
    terminalPanes,
    toggleBottom,
    toggleSidebar,
    toggleRightRail,
    handleRailSection,
    showSidebarColumn,
    showRightRail,
    handleNewShell,
    selectedPane,
    sessionForAgent,
    agentPaneTitle,
    tuiSurfaceLive,
    agentSplitActive,
    chatPercent,
    startDrag,
    mutedMap,
    setMutedMap,
    newPaneOpen,
    setNewPaneOpen,
    dragBase,
    layoutEpoch,
    markBottomPanelResized,
  } = props;

  const editor = useEditor();
  const newPaneAnchorRef = useRef<HTMLButtonElement>(null);

  const paletteCommands = useMemo(
    () =>
      buildPaletteCommands({
        agentCatalog,
        sessions: shellSessions,
        selected: selectedSession,
        onNewAgent: (agent) => void onNewSession(agent),
        onSelectSession: selectSession,
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
        onNewOpenCodeSession: (paneId) => void actions.createSession(paneId),
        onRenameSelected: () => {
          if (!selectedSession?.sessionId) return;
          const title = window.prompt('Session title', selectedSession.title);
          if (title) void actions.renameSession(selectedSession.paneId, selectedSession.sessionId, title);
        },
        onDeleteSelected: () => {
          if (!selectedSession?.sessionId) return;
          if (window.confirm(`Delete session "${selectedSession.title}"?`)) {
            void actions.deleteSession(selectedSession.paneId, selectedSession.sessionId);
          }
        },
        onSummarizeSelected: () => {
          if (selectedSession?.sessionId) {
            void actions.summarizeSession(selectedSession.paneId, selectedSession.sessionId);
          }
        },
        onShareSelected: () => {
          if (selectedSession?.sessionId) {
            void actions.shareSession(selectedSession.paneId, selectedSession.sessionId);
          }
        },
        onExportMarkdown: () => {
          if (selectedSession) void actions.exportTranscript(selectedSession, 'markdown');
        },
        onUnrevertSelected: () => {
          if (selectedSession?.sessionId) {
            void actions.unrevertSession(selectedSession.paneId, selectedSession.sessionId);
          }
        },
        editorHandlers: {
          onQuickOpen: () => editor.openQuickOpen(),
          onSearchPanel: () => editor.openSearch(),
          onReview: () => editor.setMainView('review'),
          onSave: () => void editor.saveActive(),
          onCloseTab: () => {
            if (editor.activeTabId) editor.closeTab(editor.activeTabId);
          },
        },
      }),
    [
      actions,
      agentCatalog,
      editor,
      selectSession,
      selectedSession,
      setNewPaneOpen,
      shell,
      shellSessions,
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
      editor.openQuickOpen();
    },
    onSwitchTerminalTab: () => shell.setBottomTab('terminal'),
    onJumpApproval: props.onJumpApproval,
    onApproveTop: () => {},
    onDenyTop: () => {},
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-canvas text-text" data-testid="app-shell">
      <ShellTitleBar
        newPaneButtonRef={newPaneAnchorRef}
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
              <PanelErrorBoundary region="sidebar">
              <SidebarPanel
                section={shell.railSection}
                registry={registry}
                selectedPaneId={selectedPaneId}
                connecting={railConnecting}
                onSelectSession={selectSession}
                projectPath={projectPath}
                onProjectPathChange={onProjectPathChange}
                onOpenWorkspace={handleOpenWorkspace}
              />
              </PanelErrorBoundary>
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
              className="shrink-0 min-h-0 border-r border-border-subtle flex flex-col"
            >
              <PanelErrorBoundary region="explorer">
                <ExplorerPanel />
              </PanelErrorBoundary>
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
          <PanelErrorBoundary region="main">
            <EditorWorkspace
              launcherProps={{
                onNewAgent: () => setNewPaneOpen(true),
                onTogglePanel: toggleBottom,
                onSearchFiles: () => editor.openQuickOpen(),
                onCommandPalette: () => {
                  shell.setPaletteFileMode(false);
                  shell.setPaletteOpen(true);
                },
              }}
            />
          </PanelErrorBoundary>
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
                  onEnterAgent={(id) => selectSession(id)}
                />
                <PanelErrorBoundary region="bottom">
                <BottomPanel
                  tab={shell.bottomTab}
                  onTabChange={shell.setBottomTab}
                  agentContent={
                    selectedPaneId ? (
                      <div className="relative flex flex-1 min-h-0 flex-col z-[1]">
                        {selectedSession?.sessionId && selectedSession.reverted && (
                            <RevertBanner
                              paneId={selectedSession.paneId}
                              sessionId={selectedSession.sessionId}
                            />
                          )}
                        <div className="relative flex flex-1 min-h-0 flex-row">
                        <AgentView
                          embedded
                          paneId={selectedPaneId}
                          agentType={selectedPane?.info.agent_type}
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
                        onCloseShell={(id) => onClosePane(id)}
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
                </PanelErrorBoundary>
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
              className="shrink-0 min-h-0 border-l border-border-subtle flex flex-col"
              data-testid="right-rail-column"
            >
              <PanelErrorBoundary region="right-rail">
                <RightRail />
              </PanelErrorBoundary>
            </div>
          </>
        )}
      </div>

      <NewPaneMenu
        open={newPaneOpen}
        anchorRef={newPaneAnchorRef}
        agentCatalog={agentCatalog}
        onPick={(agent) => {
          setNewPaneOpen(false);
          void onNewSession(agent);
        }}
        onClose={() => setNewPaneOpen(false)}
      />

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

function AppShellWithEditor(props: AppShellProps) {
  const demo = useDemoFixtures();
  const root = props.projectPath ?? demo?.projectPath ?? '';
  return (
    <EditorProvider projectRoot={root || null}>
      <AppShellInner {...props} />
    </EditorProvider>
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
      selectedSessionId: props.selectedSessionId,
      setSelectedSessionId: props.setSelectedSessionId,
      selectSession: (paneId: string, sessionId?: string) => {
        props.setSelectedPaneId(paneId);
        props.setSelectedSessionId(sessionId ?? null);
      },
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
      props.selectedSessionId,
      props.setSelectedSessionId,
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
      <AppShellWithEditor {...props} />
    </ShellSelectionProvider>
  );
}

function NewPaneMenu({
  open,
  anchorRef,
  agentCatalog,
  onPick,
  onClose,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLButtonElement>;
  agentCatalog: AgentCatalog;
  onPick: (agent: AgentId) => void;
  onClose: () => void;
}) {
  const presets = listLaunchPresets(agentCatalog);
  return (
    <AnchoredPopover open={open} anchorRef={anchorRef} onClose={onClose} testId="new-pane-menu">
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
    </AnchoredPopover>
  );
}
