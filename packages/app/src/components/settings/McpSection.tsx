import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  addMcpServer,
  buildMcpAddBody,
  connectMcpServer,
  disconnectMcpServer,
  errorMessage,
  listMcpServers,
  type McpServerRow,
  type McpStatusKind,
} from '../../lib/opencode/settings-data';
import { FieldInput, FieldLabel, FieldSelect, SettingsSection } from './settings-ui';

interface Props {
  /** OpenCode pane whose server is managed; null when no OpenCode agent is selected. */
  paneId: string | null;
}

type ServerKind = 'local' | 'remote';

function statusLabel(status: McpStatusKind): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'disabled':
      return 'Disconnected';
    case 'failed':
      return 'Failed';
    case 'needs_auth':
      return 'Needs sign-in';
    case 'unknown':
      return 'Unknown';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

function statusClass(status: McpStatusKind): string {
  switch (status) {
    case 'connected':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-400';
    case 'needs_auth':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-400';
    case 'disabled':
    case 'unknown':
      return 'border-pm-border text-pm-muted';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function McpSection({ paneId }: Props) {
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ServerKind>('local');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!paneId) return;
    setLoading(true);
    setError(null);
    try {
      setServers(await listMcpServers(paneId));
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
      <SettingsSection title="MCP" description="Model Context Protocol servers for OpenCode.">
        <div
          data-testid="mcp-no-pane"
          className="rounded-xl border border-pm-border bg-pm-panel p-4 text-sm text-pm-muted"
        >
          Select an OpenCode agent to manage MCP servers.
        </div>
      </SettingsSection>
    );
  }

  const toggle = async (row: McpServerRow) => {
    setBusyName(row.name);
    setError(null);
    try {
      if (row.status === 'disabled') await connectMcpServer(paneId, row.name);
      else await disconnectMcpServer(paneId, row.name);
      setServers(await listMcpServers(paneId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyName(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (adding) return;
    const built =
      kind === 'local'
        ? buildMcpAddBody({ kind: 'local', name, command })
        : buildMcpAddBody({ kind: 'remote', name, url });
    if ('error' in built) {
      setFormError(built.error);
      return;
    }
    setAdding(true);
    setFormError(null);
    try {
      setServers(await addMcpServer(paneId, built.body));
      setName('');
      setCommand('');
      setUrl('');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <SettingsSection
      title="MCP"
      description="Servers added here run for the current OpenCode server session and are not written to your config file."
    >
      {error && (
        <p role="alert" data-testid="mcp-error" className="text-xs text-red-400">
          {error}
        </p>
      )}
      {loading && servers.length === 0 && <p className="text-xs text-pm-muted">Loading servers…</p>}
      <ul className="max-h-[220px] space-y-2 overflow-y-auto pr-1" data-testid="mcp-list">
        {servers.map((row) => (
          <li
            key={row.name}
            data-testid="mcp-row"
            data-mcp-name={row.name}
            className="rounded-xl border border-pm-border bg-pm-panel p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-sm">{row.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  data-testid="mcp-status"
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass(row.status)}`}
                >
                  {statusLabel(row.status)}
                </span>
                <button
                  type="button"
                  data-testid="mcp-toggle"
                  disabled={busyName === row.name}
                  className="rounded border border-pm-border px-2 py-1 text-xs hover:bg-pm-border/40 disabled:opacity-50"
                  onClick={() => void toggle(row)}
                >
                  {row.status === 'disabled' ? 'Connect' : 'Disconnect'}
                </button>
              </div>
            </div>
            {row.error && (
              <p data-testid="mcp-row-error" className="mt-2 break-words text-xs text-red-400">
                {row.error}
              </p>
            )}
          </li>
        ))}
        {!loading && servers.length === 0 && (
          <li data-testid="mcp-empty" className="text-xs text-pm-muted">
            No MCP servers.
          </li>
        )}
      </ul>

      <form
        onSubmit={(e) => void submit(e)}
        className="space-y-3 rounded-xl border border-pm-border bg-pm-panel p-4"
        data-testid="mcp-add-form"
      >
        <h3 className="text-sm font-semibold">Add a server</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Name</FieldLabel>
            <FieldInput
              data-testid="mcp-add-name"
              aria-label="Server name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-server"
            />
          </div>
          <div>
            <FieldLabel>Type</FieldLabel>
            <FieldSelect
              data-testid="mcp-add-kind"
              aria-label="Server type"
              value={kind}
              onChange={(e) => setKind(e.target.value === 'remote' ? 'remote' : 'local')}
            >
              <option value="local">Local command</option>
              <option value="remote">Remote URL</option>
            </FieldSelect>
          </div>
        </div>
        {kind === 'local' ? (
          <div>
            <FieldLabel>Command</FieldLabel>
            <FieldInput
              data-testid="mcp-add-command"
              aria-label="Command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y @scope/server"
            />
          </div>
        ) : (
          <div>
            <FieldLabel>URL</FieldLabel>
            <FieldInput
              data-testid="mcp-add-url"
              aria-label="URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
            />
          </div>
        )}
        {formError && (
          <p role="alert" data-testid="mcp-add-error" className="text-xs text-red-400">
            {formError}
          </p>
        )}
        <button
          type="submit"
          data-testid="mcp-add-submit"
          disabled={adding}
          className="rounded-lg border border-pm-border px-3 py-2 text-sm hover:bg-pm-border/40 disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add server'}
        </button>
      </form>
    </SettingsSection>
  );
}
