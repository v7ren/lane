import type { ClaudeInfo } from '../../lib/claude-info';

/**
 * Model and mode live in the composer toolbar (useAgentControls) and commands in the slash menu.
 * What remains is the account label, until the right rail takes it over.
 */
export function ClaudeControlBar({ info }: { info: ClaudeInfo | null }) {
  if (!info?.account) return null;
  return (
    <div className="shrink-0 flex items-center px-3 pt-2" data-testid="claude-control-bar">
      <span className="text-meta text-text-3 ml-auto">{info.account}</span>
    </div>
  );
}
