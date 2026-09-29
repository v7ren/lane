import { getServerInfo } from '../opencode/client.js';

/** Native worker session id (TUI attach `-s`) for an OpenCode pane. */
export async function fetchAttachedOpenCodeSessionId(paneId: string): Promise<string | null> {
  const info = await getServerInfo(paneId);
  const id = info.attached_session_id?.trim();
  return id || null;
}
