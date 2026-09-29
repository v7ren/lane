import type { SessionRailState } from '../hooks/useSessionRail';
import { isUserShellPane } from './pane-surface';

/** Session rail rows exclude user shell PTY panes. */
export function filterAgentSessionStates(
  states: Map<string, SessionRailState>,
): Map<string, SessionRailState> {
  const next = new Map<string, SessionRailState>();
  for (const [id, row] of states) {
    if (isUserShellPane(row.agent_type ?? '')) continue;
    next.set(id, row);
  }
  return next;
}
