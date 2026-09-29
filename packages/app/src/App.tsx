import { useCallback, useEffect, useState } from 'react';
import type { AgentType } from '@loomria/shared';
import { WorkspaceHeader } from './components/WorkspaceHeader';
import { TerminalGrid } from './components/TerminalGrid';
import { SettingsPanel } from './components/SettingsPanel';
import { HomeDashboard } from './components/HomeDashboard';
import { usePaneRegistry } from './hooks/usePaneRegistry';
import { useProjectPath } from './hooks/useProjectPath';
import { useBridge } from './hooks/useBridge';
import { loadSettings, saveSettings, syncPublicSettingsToBridge } from './lib/settings';
import { tauri } from './lib/tauri';
import { LoadingScreen } from './components/LoadingScreen';
import { UpdateAvailableBanner } from './components/UpdateAvailableBanner';
import { useBootGate } from './hooks/useBootGate';
import { useAppUpdateCheck } from './hooks/useAppUpdateCheck';

type AppScreen = 'home' | 'workspace';

export default function App() {
  const registry = usePaneRegistry();
  const { projectPath, setProjectPath, ready: projectReady } = useProjectPath();
  const bridgeApi = useBridge();
  const [screen, setScreen] = useState<AppScreen>('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const bumpSettings = useCallback(() => setSettingsRevision((n) => n + 1), []);

  const boot = useBootGate({
    projectReady,
    bridgeReady: bridgeApi.isReady,
    registryReady: registry.initialReady,
  });
  const appUpdate = useAppUpdateCheck(!boot.showBoot);

  useEffect(() => {
    void syncPublicSettingsToBridge();
    let cancelled = false;
    let unlistenApply: (() => void) | null = null;

    void (async () => {
      unlistenApply = await tauri.onSettingsApply(async (patch) => {
        if (typeof patch.mobile_input_delay_ms === 'number' || typeof patch.mobile_input_visible === 'boolean') {
          const current = await loadSettings();
          const merged = { ...current };
          if (typeof patch.mobile_input_delay_ms === 'number') {
            merged.mobile_input_delay_ms = patch.mobile_input_delay_ms;
          }
          if (typeof patch.mobile_input_visible === 'boolean') {
            merged.mobile_input_visible = patch.mobile_input_visible;
          }
          await saveSettings(merged);
        }
        bumpSettings();
      });
      if (cancelled) unlistenApply?.();
    })();

    return () => {
      cancelled = true;
      unlistenApply?.();
    };
  }, [bumpSettings]);

  const handleClose = async (paneId: string) => {
    await registry.killPane(paneId);
  };
  const handleKillAll = async () => {
    await registry.killAll();
  };
  const handleRestart = async () => {
    await registry.killAll();
  };
  const handleClear = () => {
    void registry.refresh();
  };

  const handleNewSession = async (agent: AgentType) => {
    await registry.spawnPane({ agent_type: agent, cwd: projectPath ?? undefined });
  };

  return (
    <>
      {boot.showBoot && (
        <LoadingScreen steps={boot.steps} progress={boot.progress} exiting={boot.exiting} />
      )}

      {!boot.showBoot && screen === 'home' && (
        <HomeDashboard
          projectPath={projectPath}
          bridgeReady={bridgeApi.isReady}
          bridgeError={bridgeApi.error}
          registry={registry}
          settingsRevision={settingsRevision}
          onOpenWorkspace={() => setScreen('workspace')}
          onOpenSettings={() => setSettingsOpen(true)}
          onProjectPathChange={setProjectPath}
        />
      )}

      {!boot.showBoot && screen === 'workspace' && (
        <div className="flex flex-col h-full pm-workspace-enter">
          <WorkspaceHeader
            projectPath={projectPath}
            onProjectPathChange={setProjectPath}
            onKillAll={handleKillAll}
            onRestart={handleRestart}
            onClearBuffers={handleClear}
            onNewSession={handleNewSession}
            onGoHome={() => setScreen('home')}
          />
          <TerminalGrid
            registry={registry}
            projectPath={projectPath}
            onClosePane={handleClose}
          />
        </div>
      )}

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={bumpSettings}
        projectPath={projectPath}
        onProjectPathChange={setProjectPath}
        onCheckForUpdates={() => void appUpdate.refresh()}
        updateCheck={appUpdate.result}
        updateChecking={appUpdate.checking}
        onOpenRelease={() => void appUpdate.openRelease()}
      />

      {!boot.showBoot && <UpdateAvailableBanner update={appUpdate} />}
    </>
  );
}
