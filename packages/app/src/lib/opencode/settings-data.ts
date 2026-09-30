import { openCodeRequest } from './client';

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export type ProviderModel = { id: string; name: string };

export type ProviderRow = {
  id: string;
  name: string;
  connected: boolean;
  models: ProviderModel[];
};

export type ProviderAuthMethod = { type: string; label?: string };

export type ProviderConnectKind = 'api-key' | 'oauth-only' | 'none';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses `GET /provider` (`{ all, default, connected }`, `models` is a Record). */
export function parseProviderRows(raw: unknown): ProviderRow[] {
  if (!isRecord(raw) || !Array.isArray(raw.all)) return [];
  const connected = new Set(
    Array.isArray(raw.connected)
      ? raw.connected.filter((id): id is string => typeof id === 'string')
      : [],
  );
  const rows: ProviderRow[] = [];
  for (const entry of raw.all) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0) continue;
    const models: ProviderModel[] = [];
    const rawModels = entry.models;
    if (isRecord(rawModels)) {
      for (const [key, model] of Object.entries(rawModels)) {
        const m = isRecord(model) ? model : {};
        const id = typeof m.id === 'string' && m.id.length > 0 ? m.id : key;
        const name = typeof m.name === 'string' && m.name.length > 0 ? m.name : id;
        models.push({ id, name });
      }
    }
    rows.push({
      id: entry.id,
      name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : entry.id,
      connected: connected.has(entry.id),
      models,
    });
  }
  rows.sort((a, b) => {
    if (a.connected !== b.connected) return a.connected ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return rows;
}

/** Parses `GET /provider/auth`: `{ [providerID]: [{ type: 'oauth' | 'api', label }] }`. */
export function parseProviderAuthMethods(raw: unknown): Record<string, ProviderAuthMethod[]> {
  const out: Record<string, ProviderAuthMethod[]> = {};
  if (!isRecord(raw)) return out;
  for (const [id, methods] of Object.entries(raw)) {
    if (!Array.isArray(methods)) continue;
    out[id] = methods
      .filter(isRecord)
      .map((m) => ({
        type: typeof m.type === 'string' ? m.type : 'unknown',
        label: typeof m.label === 'string' ? m.label : undefined,
      }));
  }
  return out;
}

/**
 * Providers missing from `/provider/auth` have no plugin login flow and use a plain API key;
 * providers listed there can be keyed only when they advertise an `api` method.
 */
export function providerConnectKind(
  providerID: string,
  auth: Record<string, ProviderAuthMethod[]>,
): ProviderConnectKind {
  const methods = auth[providerID];
  if (!methods || methods.length === 0) return 'api-key';
  if (methods.some((m) => m.type === 'api')) return 'api-key';
  return 'oauth-only';
}

export function filterProviderRows(rows: ProviderRow[], query: string): ProviderRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
}

export function filterProviderModels(models: ProviderModel[], query: string): ProviderModel[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Sends the key to `PUT /auth/:id`. The key is only ever a local argument; it is never returned,
 * logged, or included in error text by this helper.
 */
export async function putProviderApiKey(
  paneId: string,
  providerID: string,
  key: string,
): Promise<void> {
  await openCodeRequest({
    pane_id: paneId,
    method: 'PUT',
    path: `/auth/${encodeURIComponent(providerID)}`,
    body: { type: 'api', key },
  });
}

export async function removeProviderAuth(paneId: string, providerID: string): Promise<void> {
  await openCodeRequest({
    pane_id: paneId,
    method: 'DELETE',
    path: `/auth/${encodeURIComponent(providerID)}`,
  });
}

export async function loadProviderSettings(
  paneId: string,
): Promise<{ rows: ProviderRow[]; auth: Record<string, ProviderAuthMethod[]> }> {
  const [providers, auth] = await Promise.all([
    openCodeRequest<unknown>({ pane_id: paneId, method: 'GET', path: '/provider' }),
    openCodeRequest<unknown>({ pane_id: paneId, method: 'GET', path: '/provider/auth' }),
  ]);
  return { rows: parseProviderRows(providers), auth: parseProviderAuthMethods(auth) };
}

/* ------------------------------------------------------------------ */
/* MCP                                                                 */
/* ------------------------------------------------------------------ */

export type McpStatusKind = 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'unknown';

export type McpServerRow = {
  name: string;
  status: McpStatusKind;
  error?: string;
};

export function mcpStatusKind(value: unknown): McpStatusKind {
  switch (value) {
    case 'connected':
    case 'disabled':
    case 'failed':
    case 'needs_auth':
      return value;
    default:
      return 'unknown';
  }
}

/** Parses `GET /mcp` (and the `POST /mcp` reply): `{ [name]: { status, error? } }`. */
export function parseMcpServers(raw: unknown): McpServerRow[] {
  if (!isRecord(raw)) return [];
  const rows: McpServerRow[] = [];
  for (const [name, value] of Object.entries(raw)) {
    const v = isRecord(value) ? value : {};
    rows.push({
      name,
      status: mcpStatusKind(v.status),
      error: typeof v.error === 'string' ? v.error : undefined,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export type McpAddInput =
  | { kind: 'local'; name: string; command: string }
  | { kind: 'remote'; name: string; url: string };

export type McpAddBody = {
  name: string;
  config:
    | { type: 'local'; command: string[]; enabled: true }
    | { type: 'remote'; url: string; enabled: true };
};

/** Splits a command line on whitespace, honouring single/double quotes. */
export function splitCommandLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || current.length > 0) out.push(current);
      current = '';
      has = false;
    } else {
      current += ch;
    }
  }
  if (has || current.length > 0) out.push(current);
  return out;
}

/** Validates the form and builds the `POST /mcp` body. Returns an error string on bad input. */
export function buildMcpAddBody(input: McpAddInput): { body: McpAddBody } | { error: string } {
  const name = input.name.trim();
  if (name.length === 0) return { error: 'Name is required.' };
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    return { error: 'Name may only contain letters, digits, dot, dash and underscore.' };
  }
  switch (input.kind) {
    case 'local': {
      const command = splitCommandLine(input.command.trim());
      if (command.length === 0) return { error: 'Command is required.' };
      return { body: { name, config: { type: 'local', command, enabled: true } } };
    }
    case 'remote': {
      const url = input.url.trim();
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { error: 'Enter a valid URL.' };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: 'URL must start with http:// or https://.' };
      }
      return { body: { name, config: { type: 'remote', url, enabled: true } } };
    }
    default: {
      const unreachable: never = input;
      return unreachable;
    }
  }
}

export async function listMcpServers(paneId: string): Promise<McpServerRow[]> {
  const raw = await openCodeRequest<unknown>({ pane_id: paneId, method: 'GET', path: '/mcp' });
  return parseMcpServers(raw);
}

/** `POST /mcp` registers the server at runtime and answers with the full status map. */
export async function addMcpServer(paneId: string, body: McpAddBody): Promise<McpServerRow[]> {
  const raw = await openCodeRequest<unknown>({ pane_id: paneId, method: 'POST', path: '/mcp', body });
  return parseMcpServers(raw);
}

export async function disconnectMcpServer(paneId: string, name: string): Promise<void> {
  await openCodeRequest({
    pane_id: paneId,
    method: 'POST',
    path: `/mcp/${encodeURIComponent(name)}/disconnect`,
  });
}

export async function connectMcpServer(paneId: string, name: string): Promise<void> {
  await openCodeRequest({
    pane_id: paneId,
    method: 'POST',
    path: `/mcp/${encodeURIComponent(name)}/connect`,
  });
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export const CONFIG_SHARE_VALUES = ['manual', 'auto', 'disabled'] as const;
export const CONFIG_AUTOUPDATE_VALUES = ['true', 'false', 'notify'] as const;

export type ConfigShare = (typeof CONFIG_SHARE_VALUES)[number];
export type ConfigAutoupdate = (typeof CONFIG_AUTOUPDATE_VALUES)[number];

/** Editable subset of `/config`. Empty string means "not set". */
export type ConfigDraft = {
  model: string;
  small_model: string;
  share: '' | ConfigShare;
  autoupdate: '' | ConfigAutoupdate;
};

export type ConfigPatch = Partial<{
  model: string;
  small_model: string;
  share: ConfigShare;
  autoupdate: boolean | 'notify';
}>;

export function emptyConfigDraft(): ConfigDraft {
  return { model: '', small_model: '', share: '', autoupdate: '' };
}

function isShare(value: unknown): value is ConfigShare {
  return CONFIG_SHARE_VALUES.some((v) => v === value);
}

export function configDraftFromConfig(raw: unknown): ConfigDraft {
  const draft = emptyConfigDraft();
  if (!isRecord(raw)) return draft;
  if (typeof raw.model === 'string') draft.model = raw.model;
  if (typeof raw.small_model === 'string') draft.small_model = raw.small_model;
  if (isShare(raw.share)) draft.share = raw.share;
  if (raw.autoupdate === true) draft.autoupdate = 'true';
  else if (raw.autoupdate === false) draft.autoupdate = 'false';
  else if (raw.autoupdate === 'notify') draft.autoupdate = 'notify';
  return draft;
}

/** Model ids in config are `provider/model`. */
export function validateModelRef(value: string): string | null {
  const v = value.trim();
  if (v.length === 0) return null;
  const slash = v.indexOf('/');
  if (slash <= 0 || slash === v.length - 1) return 'Use the form provider/model.';
  return null;
}

export function validateConfigDraft(draft: ConfigDraft): Partial<Record<keyof ConfigDraft, string>> {
  const errors: Partial<Record<keyof ConfigDraft, string>> = {};
  const model = validateModelRef(draft.model);
  if (model) errors.model = model;
  const small = validateModelRef(draft.small_model);
  if (small) errors.small_model = small;
  return errors;
}

/**
 * Builds the `PATCH /config` body with only the fields that differ from `original`.
 * The server cannot unset a field via PATCH, so cleared fields are not sent.
 */
export function buildConfigPatch(original: ConfigDraft, draft: ConfigDraft): ConfigPatch {
  const patch: ConfigPatch = {};
  const model = draft.model.trim();
  if (model.length > 0 && model !== original.model) patch.model = model;
  const small = draft.small_model.trim();
  if (small.length > 0 && small !== original.small_model) patch.small_model = small;
  if (draft.share !== '' && draft.share !== original.share) patch.share = draft.share;
  if (draft.autoupdate !== '' && draft.autoupdate !== original.autoupdate) {
    switch (draft.autoupdate) {
      case 'true':
        patch.autoupdate = true;
        break;
      case 'false':
        patch.autoupdate = false;
        break;
      case 'notify':
        patch.autoupdate = 'notify';
        break;
      default: {
        const unreachable: never = draft.autoupdate;
        return unreachable;
      }
    }
  }
  return patch;
}

export async function loadConfigDraft(paneId: string): Promise<ConfigDraft> {
  const raw = await openCodeRequest<unknown>({ pane_id: paneId, method: 'GET', path: '/config' });
  return configDraftFromConfig(raw);
}

/** Sends the patch, then re-reads `/config` so the form reflects what the server kept. */
export async function saveConfigPatch(paneId: string, patch: ConfigPatch): Promise<ConfigDraft> {
  await openCodeRequest({ pane_id: paneId, method: 'PATCH', path: '/config', body: patch });
  return loadConfigDraft(paneId);
}
