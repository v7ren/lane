import { ACCENT_PALETTE, DEFAULT_ACCENT, normalizeAccent } from '../../lib/theme-accent';

interface Props {
  /** Persisted accent (#RRGGBB) or undefined for the default. */
  accent: string | undefined;
  onChange: (accent: string | undefined) => void;
}

export function ThemeSection({ accent, onChange }: Props) {
  const current = normalizeAccent(accent);
  return (
    <div data-testid="settings-theme">
      <h2 className="text-lg font-semibold tracking-tight">Theme</h2>
      <p className="mt-1 text-sm text-pm-muted">
        Loomria uses a dark theme. Choose the accent colour used for highlights and selection.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3" role="radiogroup" aria-label="Accent colour">
        {ACCENT_PALETTE.map((swatch) => {
          const selected = swatch.hex === current;
          return (
            <button
              key={swatch.hex}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={swatch.label}
              title={swatch.label}
              data-testid={`accent-swatch-${swatch.hex.slice(1).toLowerCase()}`}
              className={[
                'h-8 w-8 rounded-full border-2 transition',
                selected ? 'border-pm-text ring-2 ring-pm-border' : 'border-transparent hover:border-pm-muted',
              ].join(' ')}
              style={{ backgroundColor: swatch.hex }}
              onClick={() => onChange(swatch.hex === DEFAULT_ACCENT ? undefined : swatch.hex)}
            />
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-3 text-xs text-pm-muted">
        <span data-testid="accent-current">Current: {current}</span>
        <button
          type="button"
          data-testid="accent-reset"
          disabled={current === DEFAULT_ACCENT}
          className="rounded border border-pm-border px-2 py-1 text-pm-text hover:bg-pm-border/40 disabled:opacity-40"
          onClick={() => onChange(undefined)}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
