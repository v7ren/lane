import type { OpenCodeStoreState } from '../opencode/store.js';

const PLACEHOLDER_TITLE =
  /^(loomria|puppet-master) [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function firstUserMessagePreview(state: OpenCodeStoreState, sessionId: string): string | undefined {
  const messageIds = state.messagesBySession[sessionId] ?? [];
  for (const messageId of messageIds) {
    const message = state.messages[messageId];
    if (!message || message.role !== 'user') continue;
    const partIds = state.partsByMessage[messageId] ?? [];
    const chunks: string[] = [];
    for (const partId of partIds) {
      const part = state.parts[partId];
      if (part?.type === 'text' && part.text) chunks.push(part.text);
    }
    const text = chunks.join('').trim();
    if (text) {
      return text.length > 60 ? `${text.slice(0, 57)}…` : text;
    }
  }
  return undefined;
}

function formatRelativeTime(updatedAtMs: number): string {
  const delta = Date.now() - updatedAtMs;
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function displayOpenCodeSessionTitle(
  state: OpenCodeStoreState,
  sessionId: string,
  rawTitle?: string | null,
): string {
  const trimmed = rawTitle?.trim() ?? '';
  if (trimmed && !PLACEHOLDER_TITLE.test(trimmed)) {
    return trimmed;
  }
  const preview = firstUserMessagePreview(state, sessionId);
  if (preview) return preview;
  const session = state.sessions[sessionId];
  const updatedAt = session?.time?.updated ?? session?.time?.created ?? Date.now();
  return `New session · ${formatRelativeTime(updatedAt)}`;
}
