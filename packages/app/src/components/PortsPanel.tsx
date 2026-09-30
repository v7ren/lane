import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PORT_CONFIG,
  tauri,
  type PortConfig,
  type PortOwner,
  type PortsReport,
} from '../lib/tauri';

interface Props {
  open: boolean;
  onClose: () => void;
}

const MIN_ALLOWED = 1024;
const MAX_ALLOWED = 65535;

export function validatePortConfig(cfg: PortConfig): string | null {
  const ranges: [string, number, number][] = [
    ['Agent', cfg.agent_min, cfg.agent_max],
    ['Bridge', cfg.bridge_min, cfg.bridge_max],
  ];
  for (const [name, lo, hi] of ranges) {
    if (![lo, hi].every((n) => Number.isInteger(n))) return `${name} range must be whole numbers`;
    if (lo < MIN_ALLOWED || hi > MAX_ALLOWED) {
      return `${name} range must be between ${MIN_ALLOWED} and ${MAX_ALLOWED}`;
    }
    if (lo > hi) return `${name} range start is above its end`;
  }
  if (cfg.agent_min <= cfg.bridge_max && cfg.bridge_min <= cfg.agent_max) {
    return 'Agent and bridge ranges must not overlap';
  }
  return null;
}

function ownerLabel(owner: PortOwner | null): string {
  return owner ? `${owner.name} (pid ${owner.pid})` : 'unknown process';
}

type RangeKey = keyof PortConfig;

const RANGE_FIELDS: { key: RangeKey; label: string }[] = [
  { key: 'agent_min', label: 'Agent servers from' },
  { key: 'agent_max', label: 'to' },
  { key: 'bridge_min', label: 'Bridge from' },
  { key: 'bridge_max', label: 'to' },
];

export function PortsPanel({ open, onClose }: Props) {
  const [report, setReport] = useState<PortsReport | null>(null);
  const [draft, setDraft] = useState<PortConfig>(DEFAULT_PORT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await tauri.portsReport();
      setReport(next);
      setDraft(next.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSaved(false);
    setError(null);
    void refresh();
  }, [open, refresh]);

  if (!open) return null;

  const validation = validatePortConfig(draft);
  const dirty = report !== null && JSON.stringify(draft) !== JSON.stringify(report.config);

  const save = async () => {
    const problem = validatePortConfig(draft);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await tauri.portsSetConfig(draft);
      setError(null);
      setSaved(true);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Ports"
      data-testid="ports-panel"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-pm-border bg-pm-panel p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Ports</h2>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-2 py-1 text-xs rounded border border-pm-border hover:bg-pm-border/40"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              className="px-2 py-1 text-xs rounded border border-pm-border hover:bg-pm-border/40"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        <h3 className="mb-1 text-xs font-medium text-pm-muted">Ports Loomria is using</h3>
        <div className="mb-4 rounded border border-pm-border">
          {report && report.entries.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="text-pm-muted">
                <tr className="text-left">
                  <th className="px-2 py-1 font-medium">Port</th>
                  <th className="px-2 py-1 font-medium">Role</th>
                  <th className="px-2 py-1 font-medium">Held by</th>
                  <th className="px-2 py-1 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((entry) => (
                  <tr key={entry.port} className="border-t border-pm-border">
                    <td className="px-2 py-1 font-mono">{entry.port}</td>
                    <td className="px-2 py-1">{entry.role}</td>
                    <td className="px-2 py-1">{ownerLabel(entry.owner)}</td>
                    <td className="px-2 py-1">{entry.listening ? 'listening' : 'closed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-2 py-2 text-xs text-pm-muted">No ports in use yet.</p>
          )}
        </div>

        <h3 className="mb-1 text-xs font-medium text-pm-muted">
          Other programs inside Loomria&apos;s ranges
        </h3>
        <div className="mb-4 rounded border border-pm-border px-2 py-2 text-xs">
          {report && report.foreign_in_range.length > 0 ? (
            <ul className="space-y-1" data-testid="ports-foreign">
              {report.foreign_in_range.map((f) => (
                <li key={f.port}>
                  <span className="font-mono">{f.port}</span> — {ownerLabel(f.owner)}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-pm-muted">None. Nothing else is using these ranges.</span>
          )}
        </div>

        <h3 className="mb-1 text-xs font-medium text-pm-muted">Port ranges Loomria may pick from</h3>
        <div className="mb-2 grid grid-cols-2 gap-2">
          {RANGE_FIELDS.map(({ key, label }) => (
            <label key={key} className="text-xs text-pm-muted">
              {label}
              <input
                type="number"
                aria-label={key}
                value={draft[key]}
                onChange={(e) => {
                  setSaved(false);
                  setDraft({ ...draft, [key]: Number(e.target.value) });
                }}
                className="mt-1 w-full rounded border border-pm-border bg-pm-bg px-2 py-1 text-sm text-text outline-none focus:border-pm-accent/50"
              />
            </label>
          ))}
        </div>
        <p className="mb-3 text-xs text-pm-muted">
          Changes apply to servers started after saving. Restart running agents to move them.
        </p>

        {(validation || error) && (
          <p role="alert" className="mb-2 text-xs text-red-400">
            {error ?? validation}
          </p>
        )}
        {saved && !dirty && <p className="mb-2 text-xs text-emerald-400">Saved.</p>}

        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded border border-pm-border bg-pm-bg hover:bg-pm-border/40 disabled:opacity-50"
            disabled={!dirty || validation !== null}
            onClick={() => void save()}
          >
            Save
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded border border-pm-border hover:bg-pm-border/40"
            onClick={() => {
              setSaved(false);
              setDraft(DEFAULT_PORT_CONFIG);
            }}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}
