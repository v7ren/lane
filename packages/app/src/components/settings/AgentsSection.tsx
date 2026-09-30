import { useEffect, useState } from 'react';
import { emptyAgentCatalog, type AgentCatalog } from '@loomria/shared';
import { tauri } from '../../lib/tauri';
import { SettingsSection } from './settings-ui';

export function AgentsSection() {
  const [catalog, setCatalog] = useState<AgentCatalog>(() => emptyAgentCatalog());

  useEffect(() => {
    let cancelled = false;
    void tauri.listAgents().then((next) => {
      if (!cancelled) setCatalog(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { agents, report } = catalog;
  const errors = report.errors;

  return (
    <SettingsSection title="Agents" description="Agent manifests loaded from the agents directory.">
      {errors.length > 0 && (
        <ul className="space-y-2" data-testid="agents-errors" aria-label="Manifest load errors">
          {errors.map((err) => (
            <li
              key={`${err.file}:${err.message}`}
              data-testid="agents-error-row"
              className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-400"
            >
              <div className="font-mono">{err.file}</div>
              <div className="mt-1">{err.message}</div>
            </li>
          ))}
        </ul>
      )}
      {agents.length === 0 ? (
        <div
          data-testid="agents-empty"
          className="rounded-xl border border-pm-border bg-pm-panel p-4 text-sm text-pm-muted"
        >
          No agent manifests found.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="agents-list">
          {agents.map((agent) => (
            <li
              key={agent.id}
              data-testid="agents-row"
              className="rounded-xl border border-pm-border bg-pm-panel p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{agent.label}</span>
                <span className="font-mono text-[11px] text-pm-muted">{agent.id}</span>
              </div>
              {agent.description && (
                <p className="mt-1 text-xs text-pm-muted">{agent.description}</p>
              )}
              <p className="mt-1 font-mono text-[11px] text-pm-muted">
                {[agent.command, ...agent.base_args].join(' ')}
                {agent.is_tui ? ' (TUI)' : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
