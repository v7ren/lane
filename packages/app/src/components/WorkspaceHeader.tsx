import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useCallback, useState } from 'react';
import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';

interface Props {
  agentCatalog: AgentCatalog;
  projectPath: string | null;
  onProjectPathChange: (path: string) => Promise<void>;
  onKillAll: () => void;
  onNewSession: (agent: AgentId) => void | Promise<void>;
  onOpenSettings: () => void;
}

export function WorkspaceHeader({
  agentCatalog,
  projectPath,
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
    <header className="flex items-center gap-2 px-3 py-2 border-b border-pm-border bg-pm-panel shrink-0">
      <span className="text-sm font-semibold tracking-tight">Loomria</span>
      <button
        type="button"
        onClick={() => void pickPath()}
        className="px-2 py-1 text-xs rounded border border-pm-border bg-pm-bg hover:bg-pm-border/40 truncate max-w-[36ch]"
        title={projectPath ?? 'Project folder'}
      >
        {projectPath ?? 'Project…'}
      </button>
      <div className="flex-1" />
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowNewSession((s) => !s)}
          className="px-2 py-1 text-xs rounded border border-pm-border bg-pm-bg hover:bg-pm-border/40"
        >
          New pane
        </button>
        {showNewSession && (
          <div className="absolute top-full right-0 mt-1 z-20 w-44 rounded border border-pm-border bg-pm-panel shadow-lg">
            {presets.map((p) => (
              <button
                key={p.type}
                type="button"
                onClick={() => {
                  setShowNewSession(false);
                  void onNewSession(p.type);
                }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-pm-border/40"
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
        className="px-2 py-1 text-xs rounded border border-pm-border bg-pm-bg hover:bg-pm-border/40"
      >
        Settings
      </button>
      <button
        type="button"
        onClick={onKillAll}
        className="px-2 py-1 text-xs rounded border border-pm-err/40 text-pm-err hover:bg-pm-err/10"
      >
        Kill all
      </button>
    </header>
  );
}
