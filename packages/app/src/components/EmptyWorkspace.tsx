import { listLaunchPresets, type AgentCatalog, type AgentId } from '@loomria/shared';

export function EmptyWorkspace({
  agentCatalog,
  onLaunch,
}: {
  agentCatalog: AgentCatalog;
  onLaunch: (agent: AgentId) => void;
}) {
  const presets = listLaunchPresets(agentCatalog);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-8 pointer-events-none">
      <div className="max-w-md w-full rounded-xl border border-lr-border bg-lr-panel/95 p-6 shadow-lg pointer-events-auto lr-fade-in">
        <h2 className="text-base font-semibold text-lr-text mb-1">Launch an agent</h2>
        <p className="text-sm text-lr-muted mb-4">
          Start a session in the workspace grid, or pick an agent below. Open Agent Mode from the
          session rail for chat, approvals, and tools.
        </p>
        <ul className="space-y-2">
          {presets.map((preset) => (
            <li key={preset.type}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 rounded-lg border border-lr-border bg-lr-bg hover:bg-lr-raised text-sm transition-colors"
                onClick={() => onLaunch(preset.type)}
              >
                <span className="font-medium text-lr-text">{preset.label}</span>
                <span className="block text-xs text-lr-muted mt-0.5">{preset.type}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
