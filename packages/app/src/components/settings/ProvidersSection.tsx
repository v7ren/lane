import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  errorMessage,
  filterProviderModels,
  filterProviderRows,
  loadProviderSettings,
  providerConnectKind,
  putProviderApiKey,
  type ProviderAuthMethod,
  type ProviderConnectKind,
  type ProviderRow,
} from '../../lib/opencode/settings-data';
import { setSessionComposerModel } from '../../lib/opencode/session-model-prefs';
import { FieldInput, SettingsSection } from './settings-ui';

interface Props {
  /** OpenCode pane whose server is managed; null when no OpenCode agent is selected. */
  paneId: string | null;
  /** Current OpenCode session; needed to set the composer's explicit model pick. */
  sessionId: string | null;
}

function connectLabel(kind: ProviderConnectKind): string {
  switch (kind) {
    case 'api-key':
      return 'Connect with API key';
    case 'oauth-only':
      return 'Sign-in needs the OpenCode TUI (OAuth)';
    case 'none':
      return 'Not connectable';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function ProviderDetail({
  paneId,
  sessionId,
  row,
  kind,
  onConnected,
}: {
  paneId: string;
  sessionId: string | null;
  row: ProviderRow;
  kind: ProviderConnectKind;
  onConnected: () => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyOk, setKeyOk] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [pickedModel, setPickedModel] = useState<string | null>(null);

  const submitKey = async (e: FormEvent) => {
    e.preventDefault();
    const secret = key.trim();
    if (secret.length === 0 || busy) return;
    // Drop the secret from component state before the request is awaited.
    setKey('');
    setBusy(true);
    setKeyError(null);
    setKeyOk(false);
    try {
      await putProviderApiKey(paneId, row.id, secret);
      setKeyOk(true);
      onConnected();
    } catch (err) {
      // Never echo the key back, even if a server message happens to contain it.
      setKeyError(errorMessage(err).split(secret).join('***'));
    } finally {
      setBusy(false);
    }
  };

  const applyModel = (modelID: string) => {
    if (!sessionId) return;
    setSessionComposerModel(paneId, sessionId, { providerID: row.id, modelID });
    setPickedModel(modelID);
  };

  const models = filterProviderModels(row.models, modelQuery);

  return (
    <div className="mt-3 space-y-3 border-t border-pm-border pt-3" data-testid="provider-detail">
      {!row.connected && kind === 'api-key' && (
        <form onSubmit={(e) => void submitKey(e)} className="space-y-2">
          <label className="block text-xs font-medium text-pm-muted" htmlFor="provider-api-key">
            API key for {row.name}
          </label>
          <div className="flex gap-2">
            <FieldInput
              id="provider-api-key"
              data-testid="provider-api-key-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste key"
            />
            <button
              type="submit"
              data-testid="provider-api-key-submit"
              disabled={busy || key.trim().length === 0}
              className="shrink-0 rounded-lg border border-pm-border px-3 py-2 text-sm hover:bg-pm-border/40 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save key'}
            </button>
          </div>
          <p className="text-[11px] text-pm-muted">
            The key is sent to your local OpenCode server and is not shown or kept here.
          </p>
        </form>
      )}
      {!row.connected && kind !== 'api-key' && (
        <p className="text-xs text-pm-muted" data-testid="provider-not-connectable">
          {connectLabel(kind)}.
        </p>
      )}
      {keyError && (
        <p role="alert" data-testid="provider-error" className="text-xs text-red-400">
          {keyError}
        </p>
      )}
      {keyOk && (
        <p role="status" data-testid="provider-success" className="text-xs text-emerald-400">
          Key saved. {row.name} is connecting.
        </p>
      )}
      {row.models.length > 0 && (
        <div>
          <FieldInput
            data-testid="provider-model-search"
            aria-label={`Search ${row.name} models`}
            placeholder="Search models"
            value={modelQuery}
            onChange={(e) => setModelQuery(e.target.value)}
          />
          {!sessionId && (
            <p className="mt-1 text-[11px] text-pm-muted" data-testid="provider-no-session">
              Open an OpenCode session to choose a model for its composer.
            </p>
          )}
          <ul
            className="mt-2 max-h-48 space-y-1 overflow-y-auto"
            data-testid="provider-model-list"
          >
            {models.map((m) => (
              <li
                key={m.id}
                data-testid="provider-model-row"
                className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs hover:bg-pm-border/30"
              >
                <span className="min-w-0 truncate" title={m.id}>
                  {m.name}
                </span>
                {pickedModel === m.id ? (
                  <span className="shrink-0 text-emerald-400" data-testid="provider-model-picked">
                    In use
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="provider-use-model"
                    disabled={!sessionId || !row.connected}
                    title={
                      row.connected
                        ? 'Set as the model the composer sends for this session'
                        : 'Connect this provider first'
                    }
                    className="shrink-0 rounded border border-pm-border px-2 py-0.5 hover:bg-pm-border/40 disabled:opacity-50"
                    onClick={() => applyModel(m.id)}
                  >
                    Use this model
                  </button>
                )}
              </li>
            ))}
            {models.length === 0 && <li className="px-2 py-1 text-xs text-pm-muted">No matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ProvidersSection({ paneId, sessionId }: Props) {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [auth, setAuth] = useState<Record<string, ProviderAuthMethod[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!paneId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await loadProviderSettings(paneId);
      setRows(next.rows);
      setAuth(next.auth);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [paneId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!paneId) {
    return (
      <SettingsSection title="Providers" description="Model providers known to OpenCode.">
        <div
          data-testid="providers-no-pane"
          className="rounded-xl border border-pm-border bg-pm-panel p-4 text-sm text-pm-muted"
        >
          Select an OpenCode agent to manage providers.
        </div>
      </SettingsSection>
    );
  }

  const visible = filterProviderRows(rows, query);
  const connectedCount = rows.filter((r) => r.connected).length;

  return (
    <SettingsSection
      title="Providers"
      description="Connect a provider with an API key and pick the model the composer uses."
    >
      {error && (
        <p role="alert" data-testid="providers-error" className="text-xs text-red-400">
          {error}
        </p>
      )}
      <FieldInput
        data-testid="providers-search"
        aria-label="Search providers"
        placeholder={`Search ${rows.length} providers (${connectedCount} connected)`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading && rows.length === 0 && <p className="text-xs text-pm-muted">Loading providers…</p>}
      <ul className="max-h-[320px] space-y-2 overflow-y-auto pr-1" data-testid="providers-list">
        {visible.map((row) => {
          const open = openId === row.id;
          return (
            <li
              key={row.id}
              data-testid="provider-row"
              data-provider-id={row.id}
              className="rounded-xl border border-pm-border bg-pm-panel p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{row.name}</div>
                  <div className="font-mono text-[11px] text-pm-muted">
                    {row.id} · {row.models.length} models
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    data-testid="provider-state"
                    className={[
                      'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                      row.connected
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : 'border-pm-border text-pm-muted',
                    ].join(' ')}
                  >
                    {row.connected ? 'Connected' : 'Not connected'}
                  </span>
                  <button
                    type="button"
                    data-testid="provider-toggle"
                    aria-expanded={open}
                    className="rounded border border-pm-border px-2 py-1 text-xs hover:bg-pm-border/40"
                    onClick={() => setOpenId(open ? null : row.id)}
                  >
                    {open ? 'Close' : row.connected ? 'Models' : 'Connect'}
                  </button>
                </div>
              </div>
              {open && (
                <ProviderDetail
                  paneId={paneId}
                  sessionId={sessionId}
                  row={row}
                  kind={providerConnectKind(row.id, auth)}
                  onConnected={() => void reload()}
                />
              )}
            </li>
          );
        })}
        {!loading && visible.length === 0 && (
          <li className="text-xs text-pm-muted" data-testid="providers-empty">
            No providers match.
          </li>
        )}
      </ul>
    </SettingsSection>
  );
}
