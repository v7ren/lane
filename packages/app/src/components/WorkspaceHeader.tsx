import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useCallback, useState } from 'react';
import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';
import type { AppMode } from '../hooks/useWorkspaceMode';

interface Props {
  agentCatalog: AgentCatalog;
  projectPath: string | null;
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
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
  onModeChange,
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
      <span className="text-sm font-semibold tracking-tight text-lr-text mr-1">Loomria</span>
      <div
        className="inline-flex rounded-md border border-lr-border bg-lr-bg p-0.5"
        role="tablist"
        aria-label="Workspace mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'workspace'}
          onClick={() => onModeChange('workspace')}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-lr-accent/50 ${
            mode === 'workspace'
              ? 'bg-lr-raised text-lr-text font-medium shadow-sm'
              : 'text-lr-muted hover:text-lr-text'
          }`}
        >
          Workspace
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'agent'}
          disabled={!canEnterAgent && mode === 'workspace'}
          onClick={() => onModeChange('agent')}
          className={`px-2.5 py-1 text-xs rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-lr-accent/50 disabled:opacity-40 ${
            mode === 'agent'
              ? 'bg-lr-raised text-lr-text font-medium shadow-sm'
              : 'text-lr-muted hover:text-lr-text'
          }`}
        >
          Agent
        </button>
      </div>
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
        className="px-2 py-1 text-xs rounded-md border border-lr-border/80 text-lr-muted hover:text-lr-err hover:border-lr-err/30 hover:bg-lr-err/5"
      >
        Kill all
      </button>
    </header>
  );
}
