import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentId } from '@loomria/shared';
import { getPreset } from '@loomria/shared';
import { AgentView } from './components/agent/AgentView';
import { EmptyWorkspace } from './components/EmptyWorkspace';
import { PersistentPaneSurfaces } from './components/PersistentPaneSurfaces';
import { SessionRail } from './components/SessionRail';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusLegend } from './components/StatusLegend';
import { WorkspaceHeader } from './components/WorkspaceHeader';
import { useAgentCatalog } from './hooks/useAgentCatalog';
import { useAppKeyboard } from './hooks/useAppKeyboard';
import { usePaneRegistry } from './hooks/usePaneRegistry';
import { useProjectPath } from './hooks/useProjectPath';
import { useSessionNotifications } from './hooks/useSessionNotifications';
import { useSessionRail } from './hooks/useSessionRail';
import { useWorkspaceMode } from './hooks/useWorkspaceMode';
import { useDemoFixtures } from './lib/demo/DemoContext';
import { readDemoUrlFlags } from './lib/demo-mode';
import { isTauriRuntime } from './lib/is-tauri';
import { isSessionMuted } from './lib/session-notify-prefs';
import { loadSettings, saveSettings, syncPublicSettingsToBridge } from './lib/settings';
import { tauri } from './lib/tauri';

export default function App() {
  const demo = useDemoFixtures();
  const registry = usePaneRegistry();
  const agentCatalog = useAgentCatalog();
  const sessionStates = useSessionRail();
  const {
    mode,
    agentPaneId,
    showTui,
    setShowTui,
    enterAgentMode,
    exitToWorkspace,
    toggleMode,
    setAgentPaneId,
  } = useWorkspaceMode();
  const { projectPath, setProjectPath } = useProjectPath();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [railConnecting, setRailConnecting] = useState(true);
  const [mutedMap, setMutedMap] = useState<Record<string, boolean>>({});

  const panes = registry.paneList.filter((p) => !p.info.id.startsWith('loomria-orchestrator-'));
  useEffect(() => {
    if (demo) {
      setRailConnecting(false);
      return;
    }
    const t = window.setTimeout(() => setRailConnecting(false), 2500);
    if (sessionStates.size > 0) setRailConnecting(false);
    return () => window.clearTimeout(t);
  }, [demo, sessionStates.size]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void syncPublicSettingsToBridge();
    let unlistenApply: (() => void) | null = null;
    void tauri.onSettingsApply(async () => {
      await loadSettings();
    }).then((fn) => {
      unlistenApply = fn;
    });
    return () => {
      unlistenApply?.();
    };
  }, []);

  useEffect(() => {
    if (!demo) return;
    const { view, paneId } = readDemoUrlFlags();
    if (view === 'agent') {
      enterAgentMode(paneId ?? demo.defaultAgentPaneId);
    }
  }, [demo, enterAgentMode]);

  useEffect(() => {
    if (!agentPaneId) return;
    void isSessionMuted(agentPaneId).then((muted) => {
      setMutedMap((prev) => ({ ...prev, [agentPaneId]: muted }));
    });
  }, [agentPaneId]);

  useEffect(() => {
    setLayoutEpoch((n) => n + 1);
  }, [mode, showTui, agentPaneId]);

  useSessionNotifications(sessionStates, mode, agentPaneId);

  const paneTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const pane of panes) {
      const label = getPreset(agentCatalog, pane.info.agent_type)?.label ?? pane.info.agent_type;
      m.set(pane.info.id, label);
    }
    return m;
  }, [agentCatalog, panes]);

  const selectedPane = panes.find((p) => p.info.id === agentPaneId);
  const sessionForAgent = agentPaneId ? sessionStates.get(agentPaneId) : undefined;

  const handleClose = async (paneId: string) => {
    await registry.killPane(paneId);
    if (agentPaneId === paneId) {
      setAgentPaneId(null);
      exitToWorkspace();
    }
  };

  const handleNewSession = async (agent: AgentId) => {
    const id = await registry.spawnPane({ agent_type: agent, cwd: projectPath ?? undefined });
    if (id) enterAgentMode(id);
  };

  const jumpApproval = useCallback(
    (paneId: string) => {
      enterAgentMode(paneId);
    },
    [enterAgentMode],
  );

  useAppKeyboard({
    mode,
    sessionStates,
    agentPaneId,
    onToggleMode: () => {
      if (mode === 'workspace' && agentPaneId) enterAgentMode(agentPaneId);
      else if (mode === 'agent') exitToWorkspace();
      else toggleMode();
    },
    onJumpApproval: jumpApproval,
    onApproveTop: () => {},
    onDenyTop: () => {},
  });

  const showEmpty = panes.length === 0;

  return (
    <div className="flex h-full min-h-0 lr-app-shell">
      <SessionRail
        states={sessionStates}
        agentCatalog={agentCatalog}
        paneTitles={paneTitles}
        selectedPaneId={agentPaneId}
        connecting={railConnecting}
        onSelect={enterAgentMode}
      />
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <WorkspaceHeader
          agentCatalog={agentCatalog}
          projectPath={projectPath}
          mode={mode}
          canEnterAgent={Boolean(agentPaneId ?? panes[0]?.info.id)}
          onModeToggle={() => {
            const target = agentPaneId ?? panes[0]?.info.id;
            if (mode === 'workspace' && target) enterAgentMode(target);
            else exitToWorkspace();
          }}
          onProjectPathChange={setProjectPath}
          onKillAll={() => void registry.killAll()}
          onNewSession={handleNewSession}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div
          className={`flex flex-1 min-h-0 lr-mode-transition ${mode === 'agent' ? 'flex-row' : 'flex-col'}`}
        >
          {mode === 'agent' && agentPaneId && (
            <AgentView
              paneId={agentPaneId}
              agentCatalog={agentCatalog}
              paneStatus={selectedPane?.status}
              sessionState={sessionForAgent ?? null}
              showTui={showTui}
              onToggleTui={() => setShowTui((v) => !v)}
              onExitWorkspace={exitToWorkspace}
              muted={Boolean(mutedMap[agentPaneId])}
              onMutedChange={(muted) => setMutedMap((prev) => ({ ...prev, [agentPaneId]: muted }))}
            />
          )}
          <PersistentPaneSurfaces
            mode={mode}
            agentPaneId={agentPaneId}
            showTui={showTui}
            layoutEpoch={layoutEpoch}
            agentCatalog={agentCatalog}
            registry={registry}
            projectPath={projectPath}
            sessionStates={sessionStates}
            onClosePane={(id) => void handleClose(id)}
            onEnterAgent={enterAgentMode}
          />
        </div>
        {showEmpty && (
          <EmptyWorkspace agentCatalog={agentCatalog} onLaunch={(a) => void handleNewSession(a)} />
        )}
        <StatusLegend compact />
      </div>
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        projectPath={projectPath}
        onProjectPathChange={setProjectPath}
      />
    </div>
  );
}
