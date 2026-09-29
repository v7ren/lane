import { Plus } from 'lucide-react';
import { useMemo } from 'react';
import type { AgentCatalog } from '@loomria/shared';
import { SessionRail } from '../SessionRail';
import type { SessionRailState } from '../../hooks/useSessionRail';
import type { ActivityRailSection } from '../../lib/shell-selection-context';
import { pickProjectFolder } from '../../lib/project-path';

const RECENT_KEY = 'loomria-recent-workspaces';

function readRecent(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function pushRecent(path: string): void {
  if (typeof localStorage === 'undefined') return;
  const next = [path, ...readRecent().filter((p) => p !== path)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

export function SidebarPanel({
  section,
  sessionStates,
  agentCatalog,
  paneTitles,
  selectedPaneId,
  connecting,
  onSelectSession,
  projectPath,
  onProjectPathChange,
}: {
  section: ActivityRailSection;
  sessionStates: Map<string, SessionRailState>;
  agentCatalog: AgentCatalog;
  paneTitles: Map<string, string>;
  selectedPaneId: string | null;
  connecting?: boolean;
  onSelectSession: (paneId: string) => void;
  projectPath: string | null;
  onProjectPathChange: (path: string) => Promise<void>;
}) {
  const recent = useMemo(() => {
    const list = readRecent();
    if (projectPath && !list.includes(projectPath)) {
      return [projectPath, ...list];
    }
    return list;
  }, [projectPath]);

  const openFolder = async () => {
    const picked = await pickProjectFolder(projectPath);
    if (picked) {
      pushRecent(picked);
      await onProjectPathChange(picked);
    }
  };

  if (section === 'sessions') {
    return (
      <div className="flex flex-col min-h-0 h-full bg-surface" data-testid="sidebar-sessions">
        <SessionRail
          embedded
          states={sessionStates}
          agentCatalog={agentCatalog}
          paneTitles={paneTitles}
          selectedPaneId={selectedPaneId}
          connecting={connecting}
          onSelect={onSelectSession}
        />
      </div>
    );
  }

  return (
    <aside
      className="flex flex-col min-h-0 h-full bg-surface border-r border-border-subtle"
      data-testid="sidebar-workspaces"
    >
      <div className="px-3 py-2 border-b border-border-subtle flex items-center justify-between">
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
        {recent.length === 0 && (
          <p className="text-meta text-text-3 px-2 py-3">No recent folders.</p>
        )}
        {recent.map((path) => {
          const name = path.split(/[/\\]/).filter(Boolean).pop() ?? path;
          const active = projectPath === path;
          return (
            <button
              key={path}
              type="button"
              title={path}
              onClick={() => void onProjectPathChange(path)}
              className={`w-full text-left rounded-md px-2 py-1.5 text-body transition-colors duration-ui ${
                active ? 'bg-elevated text-text' : 'text-text-2 hover:bg-hover'
              }`}
            >
              <div className="truncate font-medium">{name}</div>
              <div className="truncate text-meta text-text-3 font-mono">{path}</div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
