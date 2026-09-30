import type { Message, Part } from '@loomria/shared/opencode';

export type MessageRow = { info: Message; parts: Part[] };

/**
 * `GET /session/:id/message` returns `[{ info, parts }]`. Older fakes and some
 * paths hand back flat messages with an optional `parts`; accept both and drop
 * anything without an id so a bad row cannot file history under `undefined`.
 */
export function normalizeMessageRows(raw: unknown): MessageRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: MessageRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { info?: Message; parts?: Part[] } & Partial<Message>;
    const info = record.info ?? (record as Message);
    if (!info || typeof info.id !== 'string') continue;
    rows.push({ info, parts: Array.isArray(record.parts) ? record.parts : [] });
  }
  return rows;
}

/** Flat messages (`role`, `id`, ... plus `parts`) for callers that do not need the wire envelope. */
export function flattenMessageRows(raw: unknown): (Message & { parts: Part[] })[] {
  return normalizeMessageRows(raw).map(({ info, parts }) => ({ ...info, parts }));
}
