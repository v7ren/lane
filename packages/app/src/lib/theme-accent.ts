export const DEFAULT_ACCENT = '#3B82F6';

export interface AccentSwatch {
  hex: string;
  label: string;
}

export const ACCENT_PALETTE: readonly AccentSwatch[] = [
  { hex: '#3B82F6', label: 'Blue' },
  { hex: '#8B5CF6', label: 'Violet' },
  { hex: '#EC4899', label: 'Pink' },
  { hex: '#F97316', label: 'Orange' },
  { hex: '#22C55E', label: 'Green' },
  { hex: '#14B8A6', label: 'Teal' },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isValidAccent(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value);
}

/** Uppercase hex when valid, otherwise the default accent. */
export function normalizeAccent(value: unknown): string {
  return isValidAccent(value) ? value.toUpperCase() : DEFAULT_ACCENT;
}

/** "#3B82F6" -> "59 130 246" (the space-separated form the CSS tokens use). */
export function hexToRgbTriplet(hex: string): string {
  const h = normalizeAccent(hex).slice(1);
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/** Sets (or clears, for the default/unset) the runtime --color-accent override. */
export function applyAccent(value: string | undefined): void {
  if (typeof document === 'undefined') return;
  const style = document.documentElement.style;
  if (!isValidAccent(value) || normalizeAccent(value) === DEFAULT_ACCENT) {
    style.removeProperty('--color-accent');
    return;
  }
  style.setProperty('--color-accent', hexToRgbTriplet(value));
}
