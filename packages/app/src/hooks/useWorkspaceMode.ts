import { useCallback, useState } from 'react';

export type AppMode = 'workspace' | 'agent';

export function useWorkspaceMode() {
  const [mode, setMode] = useState<AppMode>('workspace');
  const [agentPaneId, setAgentPaneId] = useState<string | null>(null);
  const [showTui, setShowTui] = useState(false);

  const enterAgentMode = useCallback((paneId: string) => {
    setAgentPaneId(paneId);
    setMode('agent');
    setShowTui(false);
  }, []);

  const exitToWorkspace = useCallback(() => {
    setMode('workspace');
  }, []);

  const toggleMode = useCallback(() => {
    if (mode === 'workspace' && agentPaneId) {
      setMode('agent');
    } else if (mode === 'agent') {
      setMode('workspace');
    }
  }, [agentPaneId, mode]);

  return {
    mode,
    agentPaneId,
    showTui,
    setShowTui,
    setAgentPaneId,
    enterAgentMode,
    exitToWorkspace,
    toggleMode,
  };
}
