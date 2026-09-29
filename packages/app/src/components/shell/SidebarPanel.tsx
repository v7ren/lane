import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PaneRegistryApi } from '../../hooks/usePaneRegistry';
import type { ActivityRailSection } from '../../lib/shell-selection-context';
import { pickProjectFolder, projectPathsEqual } from '../../lib/project-path';
import { loadRecentWorkspaces, pushRecentWorkspace } from '../../lib/sessions/recent-workspaces';
import { SessionsSidebar } from '../sessions/SessionsSidebar';
import { useOpenCodePaneStates } from '../../lib/sessions/use-opencode-stores';
import { isOpenCodePane } from '../../lib/sessions/merge-sessions';

export function SidebarPanel({
  section,
  registry,
  selectedPaneId,
  connecting,
  onSelectSession,
  projectPath,
  onProjectPathChange,
  onOpenWorkspace,
}: {
  section: ActivityRailSection;
  registry: PaneRegistryApi;
  selectedPaneId: string | null;
  connecting?: boolean;
  onSelectSession: (paneId: string, sessionId?: string) => void;
  projectPath: string | null;
  onProjectPathChange: (path: string) => Promise<void>;
  onOpenWorkspace: (path: string) => Promise<void>;
}) {
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    void loadRecentWorkspaces().then(setRecent);
  }, [projectPath]);

  const openCodePaneIds = useMemo(
    () => registry.paneList.filter(isOpenCodePane).map((p) => p.info.id),
    [registry.paneList],
  );
  const ocStates = useOpenCodePaneStates(openCodePaneIds);

  const openFolder = async () => {
    const picked = await pickProjectFolder(projectPath);
    if (picked) {
      await onOpenWorkspace(picked);
      const next = await pushRecentWorkspace(picked);
      setRecent(next);
    }
  };

  const openWorkspace = useCallback(
    async (path: string) => {
      await onOpenWorkspace(path);
      const next = await pushRecentWorkspace(path);
      setRecent(next);
    },
    [onOpenWorkspace],
  );

  const displayRecent = useMemo(() => {
    const list = [...recent];
    if (projectPath && !list.includes(projectPath)) list.unshift(projectPath);
    return list;
  }, [projectPath, recent]);

  if (section === 'sessions') {
    return (
      <SessionsSidebar connecting={connecting} onSelectSession={onSelectSession} />
    );
  }

  return (
    <aside
      className="flex flex-col min-h-0 h-full bg-surface border-r border-border-subtle"
      data-testid="sidebar-workspaces"
    >
      <div className="px-3 h-7 border-b border-border-subtle flex items-center justify-between">
        <span className="text-section-label text-text-3">Workspaces</span>
        <button
          type="button"
          aria-label="Open folder"
          onClick={() => void openFolder()}
          className="p-1 rounded-md text-text-3 hover:text-text hover:bg-hover transition-colors duration-ui"
        >
          <Plus size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {displayRecent.length === 0 && (
          <p className="text-meta text-text-3 px-2 py-3">No recent folders.</p>
        )}
        {displayRecent.map((path) => {
          const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path;
          const active = projectPath != null && projectPathsEqual(projectPath, path);
          const paneForPath = registry.paneList.find(
            (p) => isOpenCodePane(p) && projectPathsEqual(p.info.cwd, path),
          );
          const ocState = paneForPath ? ocStates.get(paneForPath.info.id) : undefined;
          const status =
            ocState?.connectionStatus ??
            (ocState?.healthy ? 'connected' : active ? 'unknown' : undefined);
          return (
            <button
              key={path}
              type="button"
              title={path}
              onClick={() => void openWorkspace(path)}
              className={`w-full text-left rounded-sm px-2 py-1 flex flex-col gap-0.5 text-meta transition-colors duration-ui ${
                active ? 'bg-elevated text-text' : 'text-text-2 hover:bg-hover'
              }`}
            >
              <span className="truncate font-medium">{name}</span>
              {status && (
                <span className="text-[10px] text-text-3 uppercase">OpenCode · {status}</span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
