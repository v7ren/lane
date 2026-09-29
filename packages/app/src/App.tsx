import { useCallback, useEffect, useState } from 'react';
import type { AgentId } from '@loomria/shared';
import { WorkspaceHeader } from './components/WorkspaceHeader';
import { useAgentCatalog } from './hooks/useAgentCatalog';
import { useSessionRail } from './hooks/useSessionRail';
import { SessionRail } from './components/SessionRail';
import { ChatDrawer } from './components/chat/ChatDrawer';
import { TerminalGrid } from './components/TerminalGrid';
import { SettingsPanel } from './components/SettingsPanel';
import { usePaneRegistry } from './hooks/usePaneRegistry';
import { useProjectPath } from './hooks/useProjectPath';
import { loadSettings, saveSettings, syncPublicSettingsToBridge } from './lib/settings';
import { tauri } from './lib/tauri';

export default function App() {
  const registry = usePaneRegistry();
  const agentCatalog = useAgentCatalog();
  const sessionStates = useSessionRail();
  const [chatPaneId, setChatPaneId] = useState<string | null>(null);
  const { projectPath, setProjectPath } = useProjectPath();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    void syncPublicSettingsToBridge();
    let unlistenApply: (() => void) | null = null;
    void tauri.onSettingsApply(async (patch) => {
      if (
        typeof patch.mobile_input_delay_ms === 'number' ||
        typeof patch.mobile_input_visible === 'boolean'
      ) {
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
    }).then((fn) => {
      unlistenApply = fn;
    });
    return () => {
      unlistenApply?.();
    };
  }, []);

  const handleClose = async (paneId: string) => {
    await registry.killPane(paneId);
  };

  const handleNewSession = async (agent: AgentId) => {
    await registry.spawnPane({ agent_type: agent, cwd: projectPath ?? undefined });
  };

  return (
    <div className="flex flex-col h-full">
      <SessionRail states={sessionStates} />
      <WorkspaceHeader
        agentCatalog={agentCatalog}
        projectPath={projectPath}
        onProjectPathChange={setProjectPath}
        onKillAll={() => void registry.killAll()}
        onNewSession={handleNewSession}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex flex-1 min-h-0">
        <TerminalGrid
          agentCatalog={agentCatalog}
          registry={registry}
          projectPath={projectPath}
          onClosePane={handleClose}
          onOpenChat={setChatPaneId}
        />
        <ChatDrawer
          paneId={chatPaneId}
          open={chatPaneId !== null}
          sessionState={chatPaneId ? sessionStates.get(chatPaneId) ?? null : null}
          onClose={() => setChatPaneId(null)}
        />
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
