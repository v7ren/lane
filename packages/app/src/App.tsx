import { useCallback, useEffect, useState } from 'react';
import type { AgentId } from '@loomria/shared';
import { AppShell } from './components/shell/AppShell';
import { useAgentCatalog } from './hooks/useAgentCatalog';
import { usePaneRegistry } from './hooks/usePaneRegistry';
import { useProjectPath } from './hooks/useProjectPath';
import { useSessionNotifications } from './hooks/useSessionNotifications';
import { useSessionRail } from './hooks/useSessionRail';
import { useDemoFixtures } from './lib/demo/DemoContext';
import { readDemoUrlFlags } from './lib/demo-mode';
import { isTauriRuntime } from './lib/is-tauri';
import { loadSettings, syncPublicSettingsToBridge } from './lib/settings';
import { tauri } from './lib/tauri';
import { useWindowCloseGuard } from './hooks/useWindowCloseGuard';
import { CloseConfirmModal } from './components/CloseConfirmModal';
import {
  setCloseConfirmListener,
  type CloseConfirmRequest,
} from './lib/window-close-request';
import { migrateLegacyComposerModelKeys } from './lib/opencode/session-model-prefs';
import { clearTuiCompanion } from './lib/tui-companions';

export default function App() {
  const demo = useDemoFixtures();
  const registry = usePaneRegistry();
  const agentCatalog = useAgentCatalog();
  const sessionStates = useSessionRail();
  const { projectPath, setProjectPath } = useProjectPath();
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [showTui, setShowTui] = useState(false);
  const [railConnecting, setRailConnecting] = useState(true);
  const [closeConfirm, setCloseConfirm] = useState<CloseConfirmRequest | null>(null);

  useWindowCloseGuard();

  useEffect(() => {
    migrateLegacyComposerModelKeys();
  }, []);

  useEffect(() => {
    setCloseConfirmListener((req) => setCloseConfirm(req));
    return () => setCloseConfirmListener(null);
  }, []);

  useEffect(() => {
    if (demo) {
      setRailConnecting(false);
      setSelectedPaneId(demo.variant === 'empty' ? null : demo.defaultAgentPaneId);
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
    const flags = readDemoUrlFlags();
    if (flags.paneId) {
      setSelectedPaneId(flags.paneId);
      if (!flags.paneId.includes('opencode')) setSelectedSessionId(null);
    }
    else if (demo.variant !== 'empty' && demo.defaultAgentPaneId) {
      setSelectedPaneId(demo.defaultAgentPaneId);
    } else if (demo.variant === 'empty') {
      setSelectedPaneId(null);
    }
    if (flags.sessionId) setSelectedSessionId(flags.sessionId);
    else if (flags.showRevertBanner) setSelectedSessionId('demo-sess-parent');
    if (flags.showTui) setShowTui(true);
  }, [demo]);

  useSessionNotifications(sessionStates, 'agent', selectedPaneId);

  const handleClose = async (paneId: string) => {
    // Closing a chat pane also closes its hidden TUI companion.
    const tuiPaneId = clearTuiCompanion(paneId);
    if (tuiPaneId) await registry.killPane(tuiPaneId);
    await registry.killPane(paneId);
    if (selectedPaneId === paneId) {
      setSelectedPaneId(null);
    }
  };

  const handleNewSession = async (agent: AgentId) => {
    // Claude chat runs headless (stream-json) so the GUI composer works; "Show TUI" resumes it in a terminal beside the chat.
    const id = await registry.spawnPane({
      agent_type: agent,
      cwd: projectPath ?? undefined,
      surface: agent === 'claude' ? 'headless' : undefined,
    });
    if (id) {
      setSelectedPaneId(id);
      setShowTui(false);
    }
  };

  const jumpApproval = useCallback((paneId: string) => {
    setSelectedPaneId(paneId);
    setSelectedSessionId(null);
  }, []);

  return (
    <>
    {closeConfirm && (
      <CloseConfirmModal
        agentCount={closeConfirm.agentCount}
        onConfirm={() => {
          closeConfirm.resolve(true);
          setCloseConfirm(null);
        }}
        onCancel={() => {
          closeConfirm.resolve(false);
          setCloseConfirm(null);
        }}
      />
    )}
    <AppShell
      agentCatalog={agentCatalog}
      registry={registry}
      sessionStates={sessionStates}
      projectPath={projectPath}
      onProjectPathChange={setProjectPath}
      railConnecting={railConnecting}
      selectedPaneId={selectedPaneId}
      setSelectedPaneId={setSelectedPaneId}
      selectedSessionId={selectedSessionId}
      setSelectedSessionId={setSelectedSessionId}
      showTui={showTui}
      setShowTui={setShowTui}
      onNewSession={handleNewSession}
      onClosePane={(id: string) => void handleClose(id)}
      onJumpApproval={jumpApproval}
    />
    </>
  );
}
