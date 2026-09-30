/**
 * Rebindable keyboard shortcuts. Pure parse/format/match/validate logic plus a tiny
 * module-level store the keyboard hooks read at event time.
 *
 * Combo strings look like "Ctrl+Shift+L". "Ctrl" means Ctrl on Windows/Linux and Cmd on
 * macOS (the hooks accept ctrlKey || metaKey as the primary modifier).
 */

export type KeybindActionId = 'palette' | 'files' | 'bottom' | 'newAgent' | 'terminal';

export interface KeybindActionDef {
  id: KeybindActionId;
  label: string;
  defaultCombo: string;
}

export const KEYBIND_ACTIONS: readonly KeybindActionDef[] = [
  { id: 'palette', label: 'Command palette', defaultCombo: 'Ctrl+K' },
  { id: 'files', label: 'Go to file', defaultCombo: 'Ctrl+P' },
  { id: 'bottom', label: 'Toggle bottom panel', defaultCombo: 'Ctrl+J' },
  { id: 'newAgent', label: 'New agent', defaultCombo: 'Ctrl+Shift+L' },
  { id: 'terminal', label: 'Terminal tab', defaultCombo: 'Ctrl+`' },
];

/** Shortcuts that exist but cannot be rebound; a new binding may not collide with them. */
export const FIXED_SHORTCUTS: readonly { label: string; combo: string }[] = [
  { label: 'Toggle sidebar', combo: 'Ctrl+B' },
  { label: 'Approve top request', combo: 'Ctrl+Shift+A' },
  { label: 'Deny top request', combo: 'Ctrl+Shift+D' },
  { label: 'Jump to next approval', combo: 'Ctrl+Shift+N' },
];

export interface Combo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Normalized key: lowercase letter/digit/symbol, or a name like "F5", "Enter", "ArrowUp". */
  key: string;
}

export type KeybindOverrides = Partial<Record<KeybindActionId, string>>;
export type EffectiveKeybinds = Record<KeybindActionId, string>;

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);
const FUNCTION_KEY_RE = /^F([1-9]|1[0-2])$/;
const RESERVED_CTRL_KEYS = new Set(['c', 'v', 'x', 'z', 'a']);

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  spacebar: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  space: 'Space',
};

export function normalizeKeyName(key: string): string {
  if (key.length === 1) return key === ' ' ? 'Space' : key.toLowerCase();
  const alias = KEY_ALIASES[key.toLowerCase()];
  if (alias) return alias;
  const upper = key.toUpperCase();
  if (FUNCTION_KEY_RE.test(upper)) return upper;
  return key;
}

export function parseCombo(text: string): Combo | null {
  const parts = text.split('+');
  // A trailing "+" key (e.g. "Ctrl++") yields an empty last part.
  if (parts.length >= 2 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts.splice(parts.length - 2, 2, '+');
  }
  if (parts.length === 0) return null;
  const rawKey = parts[parts.length - 1];
  if (!rawKey) return null;
  const combo: Combo = { ctrl: false, alt: false, shift: false, key: normalizeKeyName(rawKey) };
  for (const mod of parts.slice(0, -1)) {
    switch (mod.toLowerCase()) {
      case 'ctrl':
      case 'cmd':
      case 'meta':
      case 'mod':
        if (combo.ctrl) return null;
        combo.ctrl = true;
        break;
      case 'alt':
        if (combo.alt) return null;
        combo.alt = true;
        break;
      case 'shift':
        if (combo.shift) return null;
        combo.shift = true;
        break;
      default:
        return null;
    }
  }
  if (MODIFIER_KEYS.has(rawKey)) return null;
  return combo;
}

function displayKey(key: string): string {
  return key.length === 1 ? key.toUpperCase() : key;
}

/** Canonical storage string, e.g. "Ctrl+Shift+L". */
export function comboToString(combo: Combo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  parts.push(displayKey(combo.key));
  return parts.join('+');
}

/** Human display; uses Mac symbols when isMac. */
export function formatCombo(combo: Combo, isMac = false): string {
  if (isMac) {
    return (
      (combo.ctrl ? '⌘' : '') +
      (combo.alt ? '⌥' : '') +
      (combo.shift ? '⇧' : '') +
      displayKey(combo.key)
    );
  }
  return comboToString(combo);
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');
}

/** Builds a combo from a keydown; returns null for bare modifier presses. */
export function comboFromEvent(e: KeyboardEvent): Combo | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  let key = normalizeKeyName(e.key);
  const code = e.code ?? '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (code === 'Backquote') key = '`';
  return { ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey, key };
}

export function combosEqual(a: Combo, b: Combo): boolean {
  return a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.key === b.key;
}

/** True when the keydown exactly matches the combo (modifiers must match exactly). */
export function matchesCombo(e: KeyboardEvent, combo: Combo): boolean {
  const pressed = comboFromEvent(e);
  return pressed !== null && combosEqual(pressed, combo);
}

export function matchesBinding(e: KeyboardEvent, binding: string): boolean {
  const combo = parseCombo(binding);
  return combo !== null && matchesCombo(e, combo);
}

export type ComboValidation = { ok: true } | { ok: false; reason: string };

export function validateCombo(combo: Combo): ComboValidation {
  if (combo.key === 'Escape') return { ok: false, reason: 'Esc is reserved.' };
  const isFunctionKey = FUNCTION_KEY_RE.test(combo.key);
  if (!combo.ctrl && !combo.alt && !isFunctionKey) {
    return { ok: false, reason: 'Include Ctrl, Alt or Cmd (or use a function key).' };
  }
  if (combo.ctrl && !combo.alt && !combo.shift && RESERVED_CTRL_KEYS.has(combo.key)) {
    return { ok: false, reason: `${comboToString(combo)} is reserved for editing.` };
  }
  return { ok: true };
}

export function defaultCombo(id: KeybindActionId): string {
  const def = KEYBIND_ACTIONS.find((a) => a.id === id);
  return def ? def.defaultCombo : '';
}

/** Merge stored overrides over defaults, ignoring unknown ids and unparseable/invalid combos. */
export function resolveKeybinds(overrides: Record<string, string> | undefined | null): EffectiveKeybinds {
  const out = {} as EffectiveKeybinds;
  for (const def of KEYBIND_ACTIONS) {
    const raw = overrides?.[def.id];
    const parsed = typeof raw === 'string' ? parseCombo(raw) : null;
    out[def.id] = parsed && validateCombo(parsed).ok ? comboToString(parsed) : def.defaultCombo;
  }
  return out;
}

export type KeybindConflict =
  | { kind: 'action'; id: KeybindActionId; label: string }
  | { kind: 'fixed'; label: string };

/** Finds another action (or fixed shortcut) already using this combo. */
export function findConflict(
  bindings: EffectiveKeybinds,
  actionId: KeybindActionId,
  combo: Combo,
): KeybindConflict | null {
  for (const def of KEYBIND_ACTIONS) {
    if (def.id === actionId) continue;
    const other = parseCombo(bindings[def.id]);
    if (other && combosEqual(other, combo)) return { kind: 'action', id: def.id, label: def.label };
  }
  for (const fixed of FIXED_SHORTCUTS) {
    const other = parseCombo(fixed.combo);
    if (other && combosEqual(other, combo)) return { kind: 'fixed', label: fixed.label };
  }
  return null;
}

export type SetBindingResult =
  | { ok: true; overrides: KeybindOverrides }
  | { ok: false; reason: string; conflict?: KeybindConflict };

/** Validates and applies one rebinding; storing the default removes the override. */
export function setBinding(
  overrides: Record<string, string> | undefined | null,
  actionId: KeybindActionId,
  combo: Combo,
): SetBindingResult {
  const valid = validateCombo(combo);
  if (!valid.ok) return valid;
  const conflict = findConflict(resolveKeybinds(overrides), actionId, combo);
  if (conflict) {
    return { ok: false, reason: `Conflicts with "${conflict.label}".`, conflict };
  }
  return { ok: true, overrides: withOverride(overrides, actionId, comboToString(combo)) };
}

export function resetBinding(
  overrides: Record<string, string> | undefined | null,
  actionId: KeybindActionId,
): KeybindOverrides {
  return withOverride(overrides, actionId, undefined);
}

function withOverride(
  overrides: Record<string, string> | undefined | null,
  actionId: KeybindActionId,
  value: string | undefined,
): KeybindOverrides {
  const next: KeybindOverrides = {};
  for (const def of KEYBIND_ACTIONS) {
    const existing = overrides?.[def.id];
    if (def.id !== actionId && typeof existing === 'string') next[def.id] = existing;
  }
  if (value !== undefined && value !== defaultCombo(actionId)) next[actionId] = value;
  return next;
}

/* ---- runtime store read by the keyboard hooks ---- */

let current: EffectiveKeybinds = resolveKeybinds(undefined);

export function getKeybinds(): EffectiveKeybinds {
  return current;
}

export function applyKeybinds(overrides: Record<string, string> | undefined | null): void {
  current = resolveKeybinds(overrides);
}

/** True when the event triggers the given action under the effective bindings. */
export function matchesAction(e: KeyboardEvent, actionId: KeybindActionId): boolean {
  switch (actionId) {
    case 'palette':
    case 'files':
    case 'bottom':
    case 'newAgent':
    case 'terminal':
      return matchesBinding(e, current[actionId]);
    default: {
      const unreachable: never = actionId;
      return unreachable;
    }
  }
}
