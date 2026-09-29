import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useCallback, useState } from 'react';
import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';
import type { AppMode } from '../hooks/useWorkspaceMode';

interface Props {
  agentCatalog: AgentCatalog;
  projectPath: string | null;
  mode: AppMode;
  onModeToggle: () => void;
  canEnterAgent: boolean;
  onProjectPathChange: (path: string) => Promise<void>;
  onKillAll: () => void;
  onNewSession: (agent: AgentId) => void | Promise<void>;
  onOpenSettings: () => void;
}

export function WorkspaceHeader({
  agentCatalog,
  projectPath,
  mode,
  onModeToggle,
  canEnterAgent,
  onProjectPathChange,
  onKillAll,
  onNewSession,
  onOpenSettings,
}: Props) {
  const [showNewSession, setShowNewSession] = useState(false);
  const presets = listLaunchPresets(agentCatalog);

  const pickPath = useCallback(async () => {
    const result = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: (await homeDir()) ?? projectPath ?? undefined,
    });
    if (typeof result === 'string') {
      await onProjectPathChange(result);
    }
  }, [onProjectPathChange, projectPath]);

  return (
    <header className="flex items-center gap-2 px-3 py-2 border-b border-lr-border bg-lr-panel shrink-0">
      <span className="text-sm font-semibold tracking-tight text-lr-text">Loomria</span>
      <span className="text-[10px] uppercase tracking-wider text-lr-muted px-1.5 py-0.5 rounded border border-lr-border">
        {mode === 'workspace' ? 'Workspace' : 'Agent'}
      </span>
      <button
        type="button"
        disabled={!canEnterAgent && mode === 'workspace'}
        onClick={onModeToggle}
        className="px-2 py-1 text-xs rounded-md border border-lr-border bg-lr-bg hover:bg-lr-raised disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-lr-accent/50"
        aria-label={mode === 'workspace' ? 'Switch to Agent Mode' : 'Switch to Workspace Mode'}
      >
        {mode === 'workspace' ? 'Agent mode' : 'Workspace'}
      </button>
      <button
        type="button"
        onClick={() => void pickPath()}
        className="px-2 py-1 text-xs rounded-md border border-lr-border bg-lr-bg hover:bg-lr-raised truncate max-w-[36ch] focus:outline-none focus-visible:ring-2 focus-visible:ring-lr-accent/50"
        title={projectPath ?? 'Project folder'}
      >
        {projectPath ?? 'Project…'}
      </button>
      <div className="flex-1" />
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowNewSession((s) => !s)}
          className="px-2 py-1 text-xs rounded-md border border-lr-border bg-lr-bg hover:bg-lr-raised"
        >
          New pane
        </button>
        {showNewSession && (
          <div className="absolute top-full right-0 mt-1 z-20 w-44 rounded-lg border border-lr-border bg-lr-panel shadow-lg">
            {presets.map((p) => (
              <button
                key={p.type}
                type="button"
                onClick={() => {
                  setShowNewSession(false);
                  void onNewSession(p.type);
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-lr-border/40"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className="px-2 py-1 text-xs rounded-md border border-lr-border bg-lr-bg hover:bg-lr-raised"
      >
        Settings
      </button>
      <button
        type="button"
        onClick={onKillAll}
        className="px-2 py-1 text-xs rounded-md border border-lr-err/40 text-lr-err hover:bg-lr-err/10"
      >
        Kill all
      </button>
    </header>
  );
}
