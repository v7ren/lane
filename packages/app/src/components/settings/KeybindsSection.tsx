import { useEffect, useState } from 'react';
import {
  KEYBIND_ACTIONS,
  FIXED_SHORTCUTS,
  comboFromEvent,
  defaultCombo,
  formatCombo,
  isMacPlatform,
  parseCombo,
  resetBinding,
  resolveKeybinds,
  setBinding,
  type KeybindActionId,
} from '../../lib/keybinds';

interface Props {
  /** Persisted overrides, or undefined when everything is default. */
  keybinds: Record<string, string> | undefined;
  onChange: (next: Record<string, string> | undefined) => void;
}

function show(combo: string, mac: boolean): string {
  const parsed = parseCombo(combo);
  return parsed ? formatCombo(parsed, mac) : combo;
}

export function KeybindsSection({ keybinds, onChange }: Props) {
  const [capturing, setCapturing] = useState<KeybindActionId | null>(null);
  const [error, setError] = useState<{ id: KeybindActionId; message: string } | null>(null);
  const mac = isMacPlatform();
  const effective = resolveKeybinds(keybinds);

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        setError(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const result = setBinding(keybinds, capturing, combo);
      if (!result.ok) {
        const prefix = result.conflict ? 'CONFLICT: ' : '';
        setError({ id: capturing, message: prefix + result.reason });
        return;
      }
      setError(null);
      setCapturing(null);
      onChange(Object.keys(result.overrides).length > 0 ? result.overrides : undefined);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, keybinds, onChange]);

  const hasOverrides = KEYBIND_ACTIONS.some((def) => effective[def.id] !== def.defaultCombo);

  return (
    <div data-testid="settings-keybinds">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Keybinds</h2>
        <button
          type="button"
          data-testid="keybinds-reset-all"
          disabled={!hasOverrides}
          className="rounded border border-pm-border px-2 py-1 text-xs hover:bg-pm-border/40 disabled:opacity-40"
          onClick={() => {
            setCapturing(null);
            setError(null);
            onChange(undefined);
          }}
        >
          Reset all
        </button>
      </div>
      <ul className="mt-3 divide-y divide-pm-border rounded border border-pm-border">
        {KEYBIND_ACTIONS.map((def) => {
          const isCapturing = capturing === def.id;
          const isDefault = effective[def.id] === defaultCombo(def.id);
          const err = error && error.id === def.id ? error.message : null;
          return (
            <li key={def.id} className="px-3 py-2" data-testid={`keybind-row-${def.id}`}>
              <div className="flex items-center gap-3">
                <span className="flex-1 text-sm">{def.label}</span>
                <kbd
                  data-testid={`keybind-combo-${def.id}`}
                  className="rounded border border-pm-border bg-pm-bg px-2 py-0.5 text-xs"
                >
                  {isCapturing ? 'Press keys...' : show(effective[def.id], mac)}
                </kbd>
                <button
                  type="button"
                  data-testid={`keybind-change-${def.id}`}
                  className="rounded border border-pm-border px-2 py-1 text-xs hover:bg-pm-border/40"
                  onClick={() => {
                    setError(null);
                    setCapturing(isCapturing ? null : def.id);
                  }}
                >
                  {isCapturing ? 'Cancel' : 'Change'}
                </button>
                <button
                  type="button"
                  data-testid={`keybind-reset-${def.id}`}
                  disabled={isDefault}
                  className="rounded border border-pm-border px-2 py-1 text-xs hover:bg-pm-border/40 disabled:opacity-40"
                  onClick={() => {
                    setError(null);
                    setCapturing(null);
                    const next = resetBinding(keybinds, def.id);
                    onChange(Object.keys(next).length > 0 ? next : undefined);
                  }}
                >
                  Reset
                </button>
              </div>
              {err ? (
                <p role="alert" data-testid={`keybind-error-${def.id}`} className="mt-1 text-xs text-red-400">
                  {err}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-pm-muted">
        Press the new combination after clicking Change. Esc cancels. Fixed shortcuts:{' '}
        {FIXED_SHORTCUTS.map((f) => `${f.label} (${show(f.combo, mac)})`).join(', ')}.
      </p>
    </div>
  );
}
