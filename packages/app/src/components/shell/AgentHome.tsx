import { FolderOpen } from 'lucide-react';
import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';
import { agentFamily } from '../../lib/agent-capabilities';
import { formatCombo, getKeybinds, isMacPlatform, parseCombo } from '../../lib/keybinds';
import { formatRelativeTime } from '../../lib/sessions/filter-sort';
import type { ShellSession } from '../../lib/shell-data';
import { AgentMark } from '../agent/AgentMark';
import { LoomMark } from './LoomMark';

const MAX_RECENT_SESSIONS = 5;

function projectBasename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path;
}

function displayCombo(binding: string): string {
  const combo = parseCombo(binding);
  return combo ? formatCombo(combo, isMacPlatform()) : binding;
}

/** Agent-mode empty centre: pick an agent, resume a recent session, or change folder. */
export function AgentHome({
  projectPath,
  agentCatalog,
  recentSessions,
  onNewSession,
  onSelectSession,
  onChangeFolder,
}: {
  projectPath: string | null;
  agentCatalog: AgentCatalog;
  recentSessions: ShellSession[];
  onNewSession: (agent: AgentId) => void;
  onSelectSession: (paneId: string, sessionId?: string) => void;
  onChangeFolder: () => void;
}) {
  const presets = listLaunchPresets(agentCatalog);
  const recent = recentSessions.slice(0, MAX_RECENT_SESSIONS);
  const keys = getKeybinds();
  const hints = [
    { label: 'new agent', combo: keys.newAgent },
    { label: 'palette', combo: keys.palette },
    { label: 'IDE mode', combo: keys.uiMode },
  ];

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto bg-canvas"
      data-testid="agent-home"
    >
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-6 px-6 py-10">
        <LoomMark className="w-11 h-11 text-text-3 opacity-80" />
        <h1 className="text-lg font-medium tracking-tight text-text">What should we work on?</h1>

        <div className="flex items-center gap-2 text-meta text-text-2" data-testid="agent-home-project">
          <FolderOpen size={14} strokeWidth={1.5} className="shrink-0 text-text-3" aria-hidden />
          <span className="truncate max-w-[18rem]" title={projectPath ?? undefined}>
            {projectPath ? projectBasename(projectPath) : 'No folder selected'}
          </span>
          <button
            type="button"
            onClick={onChangeFolder}
            data-testid="agent-home-change-folder"
            className="rounded-md border border-border-subtle px-2 py-0.5 text-text-3 hover:text-text hover:bg-hover transition-colors duration-ui"
          >
            Change folder
          </button>
        </div>

        {presets.length > 0 && (
          <ul className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2" data-testid="agent-home-agents">
            {presets.map((preset) => (
              <li key={preset.type}>
                <button
                  type="button"
                  onClick={() => onNewSession(preset.type)}
                  data-testid={`agent-home-card-${preset.type}`}
                  className="flex w-full items-start gap-3 rounded-md border border-border-subtle bg-surface px-3 py-2.5 text-left hover:bg-hover hover:border-border transition-colors duration-ui"
                >
                  <span className="mt-0.5">
                    <AgentMark family={agentFamily(preset.type)} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-body font-medium text-text">{preset.label}</span>
                    {preset.description && (
                      <span className="block text-meta text-text-3 line-clamp-2">{preset.description}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {recent.length > 0 && (
          <section className="w-full" aria-label="Recent sessions" data-testid="agent-home-recent">
            <h2 className="mb-1 px-1 text-section-label text-text-3">Recent</h2>
            <ul className="space-y-0.5">
              {recent.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelectSession(s.paneId, s.sessionId)}
                    data-testid="agent-home-session"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta text-text-2 hover:bg-hover transition-colors duration-ui"
                  >
                    <AgentMark family={s.agentFamily} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <span className="shrink-0 text-text-3">{formatRelativeTime(s.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-meta text-text-3" data-testid="agent-home-hints">
          {hints.map((h, i) => (
            <span key={h.label} className="inline-flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>·</span>}
              <kbd className="px-1.5 py-0.5 rounded border border-border-subtle bg-elevated text-[11px] font-mono">
                {displayCombo(h.combo)}
              </kbd>
              <span>{h.label}</span>
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
