import { afterEach, describe, expect, it } from 'vitest';
import {
  KEYBIND_ACTIONS,
  applyKeybinds,
  combosEqual,
  comboFromEvent,
  comboToString,
  findConflict,
  formatCombo,
  getKeybinds,
  matchesAction,
  matchesBinding,
  matchesCombo,
  parseCombo,
  resetBinding,
  resolveKeybinds,
  setBinding,
  validateCombo,
  type Combo,
} from './keybinds';

function ev(init: KeyboardEventInit & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

function c(text: string): Combo {
  const parsed = parseCombo(text);
  if (!parsed) throw new Error(`bad combo ${text}`);
  return parsed;
}

afterEach(() => applyKeybinds(undefined));

describe('parseCombo / comboToString', () => {
  it('parses and round-trips', () => {
    expect(c('Ctrl+Shift+L')).toEqual({ ctrl: true, alt: false, shift: true, key: 'l' });
    expect(comboToString(c('ctrl+shift+l'))).toBe('Ctrl+Shift+L');
    expect(comboToString(c('Ctrl+`'))).toBe('Ctrl+`');
    expect(comboToString(c('Shift+Alt+Ctrl+K'))).toBe('Ctrl+Alt+Shift+K');
    expect(comboToString(c('F5'))).toBe('F5');
    expect(comboToString(c('Ctrl+ArrowUp'))).toBe('Ctrl+ArrowUp');
  });

  it('treats Cmd/Meta/Mod as the primary modifier', () => {
    expect(c('Cmd+K')).toEqual(c('Ctrl+K'));
    expect(c('Meta+K')).toEqual(c('Ctrl+K'));
    expect(c('Mod+K')).toEqual(c('Ctrl+K'));
  });

  it('parses a plus key', () => {
    expect(c('Ctrl++')).toEqual({ ctrl: true, alt: false, shift: false, key: '+' });
  });

  it('rejects malformed input', () => {
    expect(parseCombo('')).toBeNull();
    expect(parseCombo('Ctrl+')).toBeNull();
    expect(parseCombo('Foo+K')).toBeNull();
    expect(parseCombo('Ctrl+Ctrl+K')).toBeNull();
    expect(parseCombo('Ctrl+Shift')).toBeNull();
  });
});

describe('formatCombo', () => {
  it('formats for Windows/Linux and Mac', () => {
    expect(formatCombo(c('Ctrl+Shift+L'), false)).toBe('Ctrl+Shift+L');
    expect(formatCombo(c('Ctrl+Shift+L'), true)).toBe('⌘⇧L');
    expect(formatCombo(c('Ctrl+Alt+J'), true)).toBe('⌘⌥J');
  });
});

describe('comboFromEvent / matchesCombo', () => {
  it('returns null for bare modifiers', () => {
    expect(comboFromEvent(ev({ key: 'Control', ctrlKey: true }))).toBeNull();
    expect(comboFromEvent(ev({ key: 'Shift', shiftKey: true }))).toBeNull();
    expect(comboFromEvent(ev({ key: 'Meta', metaKey: true }))).toBeNull();
  });

  it('maps ctrl and meta to the primary modifier', () => {
    expect(matchesCombo(ev({ key: 'k', ctrlKey: true }), c('Ctrl+K'))).toBe(true);
    expect(matchesCombo(ev({ key: 'k', metaKey: true }), c('Ctrl+K'))).toBe(true);
    expect(matchesCombo(ev({ key: 'K', ctrlKey: true }), c('Ctrl+K'))).toBe(true);
  });

  it('requires exact modifiers', () => {
    expect(matchesCombo(ev({ key: 'k' }), c('Ctrl+K'))).toBe(false);
    expect(matchesCombo(ev({ key: 'k', ctrlKey: true, shiftKey: true }), c('Ctrl+K'))).toBe(false);
    expect(matchesCombo(ev({ key: 'k', ctrlKey: true, altKey: true }), c('Ctrl+K'))).toBe(false);
    expect(matchesCombo(ev({ key: 'L', ctrlKey: true, shiftKey: true }), c('Ctrl+Shift+L'))).toBe(true);
  });

  it('prefers event.code for letters, digits and backquote', () => {
    expect(comboFromEvent(ev({ key: 'ì', code: 'KeyL', ctrlKey: true, altKey: true }))?.key).toBe('l');
    expect(comboFromEvent(ev({ key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true }))?.key).toBe('1');
    expect(matchesCombo(ev({ key: '~', code: 'Backquote', ctrlKey: true, shiftKey: true }), c('Ctrl+Shift+`'))).toBe(true);
    expect(matchesCombo(ev({ key: '`', ctrlKey: true }), c('Ctrl+`'))).toBe(true);
  });

  it('matches function keys without modifiers', () => {
    expect(matchesCombo(ev({ key: 'F5' }), c('F5'))).toBe(true);
    expect(matchesCombo(ev({ key: 'F5', ctrlKey: true }), c('F5'))).toBe(false);
  });

  it('matchesBinding tolerates invalid strings', () => {
    expect(matchesBinding(ev({ key: 'k', ctrlKey: true }), 'nonsense+')).toBe(false);
  });

  it('combosEqual compares all fields', () => {
    expect(combosEqual(c('Ctrl+K'), c('Cmd+k'))).toBe(true);
    expect(combosEqual(c('Ctrl+K'), c('Ctrl+Shift+K'))).toBe(false);
  });
});

describe('validateCombo', () => {
  it('accepts ctrl/alt combos and function keys', () => {
    expect(validateCombo(c('Ctrl+K')).ok).toBe(true);
    expect(validateCombo(c('Alt+K')).ok).toBe(true);
    expect(validateCombo(c('Ctrl+Shift+L')).ok).toBe(true);
    expect(validateCombo(c('F2')).ok).toBe(true);
    expect(validateCombo(c('Shift+F2')).ok).toBe(true);
  });

  it('rejects bare keys and shift-only combos', () => {
    expect(validateCombo(c('K')).ok).toBe(false);
    expect(validateCombo(c('Shift+K')).ok).toBe(false);
    expect(validateCombo(c('Enter')).ok).toBe(false);
  });

  it('rejects reserved edit combos', () => {
    for (const k of ['C', 'V', 'X', 'Z', 'A']) {
      const res = validateCombo(c(`Ctrl+${k}`));
      expect(res.ok).toBe(false);
    }
    expect(validateCombo(c('Ctrl+Shift+Z')).ok).toBe(true);
  });

  it('rejects Escape in any form', () => {
    expect(validateCombo(c('Escape')).ok).toBe(false);
    expect(validateCombo(c('Ctrl+Esc')).ok).toBe(false);
  });
});

describe('resolveKeybinds / setBinding / resetBinding', () => {
  it('uses defaults when unset', () => {
    const eff = resolveKeybinds(undefined);
    expect(eff).toEqual({
      palette: 'Ctrl+K',
      files: 'Ctrl+P',
      bottom: 'Ctrl+J',
      newAgent: 'Ctrl+Shift+L',
      terminal: 'Ctrl+`',
    });
  });

  it('applies valid overrides and ignores invalid or unknown ones', () => {
    const eff = resolveKeybinds({ palette: 'ctrl+shift+p', files: 'Ctrl+C', bottom: 'garbage+', bogus: 'Ctrl+Q' });
    expect(eff.palette).toBe('Ctrl+Shift+P');
    expect(eff.files).toBe('Ctrl+P');
    expect(eff.bottom).toBe('Ctrl+J');
    expect(Object.keys(eff)).toHaveLength(KEYBIND_ACTIONS.length);
  });

  it('sets a binding', () => {
    const res = setBinding(undefined, 'palette', c('Ctrl+Shift+P'));
    expect(res).toEqual({ ok: true, overrides: { palette: 'Ctrl+Shift+P' } });
  });

  it('removes the override when set back to the default', () => {
    const res = setBinding({ palette: 'Ctrl+Shift+P' }, 'palette', c('Ctrl+K'));
    expect(res).toEqual({ ok: true, overrides: {} });
  });

  it('refuses a duplicate of another action and names it', () => {
    const res = setBinding(undefined, 'palette', c('Ctrl+P'));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.conflict).toEqual({ kind: 'action', id: 'files', label: 'Go to file' });
      expect(res.reason).toContain('Go to file');
    }
  });

  it('detects conflicts against overridden bindings, not just defaults', () => {
    const overrides = { files: 'Ctrl+Shift+F' };
    expect(setBinding(overrides, 'palette', c('Ctrl+Shift+F')).ok).toBe(false);
    // Ctrl+P is free now that files moved away.
    expect(setBinding(overrides, 'palette', c('Ctrl+P')).ok).toBe(true);
  });

  it('refuses collisions with fixed shortcuts', () => {
    const res = setBinding(undefined, 'palette', c('Ctrl+B'));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.conflict).toEqual({ kind: 'fixed', label: 'Toggle sidebar' });
  });

  it('allows an action to keep its own combo', () => {
    expect(findConflict(resolveKeybinds(undefined), 'palette', c('Ctrl+K'))).toBeNull();
  });

  it('refuses invalid combos', () => {
    expect(setBinding(undefined, 'palette', c('Ctrl+C')).ok).toBe(false);
    expect(setBinding(undefined, 'palette', c('K')).ok).toBe(false);
  });

  it('resets one binding and keeps the others', () => {
    const next = resetBinding({ palette: 'Ctrl+Shift+P', files: 'Ctrl+Shift+F' }, 'palette');
    expect(next).toEqual({ files: 'Ctrl+Shift+F' });
  });
});

describe('runtime store', () => {
  it('matchesAction reads the effective bindings', () => {
    expect(matchesAction(ev({ key: 'k', ctrlKey: true }), 'palette')).toBe(true);
    applyKeybinds({ palette: 'Alt+K' });
    expect(getKeybinds().palette).toBe('Alt+K');
    expect(matchesAction(ev({ key: 'k', ctrlKey: true }), 'palette')).toBe(false);
    expect(matchesAction(ev({ key: 'k', altKey: true }), 'palette')).toBe(true);
    applyKeybinds(undefined);
    expect(matchesAction(ev({ key: 'k', ctrlKey: true }), 'palette')).toBe(true);
  });

  it('matches every default action', () => {
    expect(matchesAction(ev({ key: 'p', ctrlKey: true }), 'files')).toBe(true);
    expect(matchesAction(ev({ key: 'j', metaKey: true }), 'bottom')).toBe(true);
    expect(matchesAction(ev({ key: 'L', ctrlKey: true, shiftKey: true }), 'newAgent')).toBe(true);
    expect(matchesAction(ev({ key: '`', ctrlKey: true }), 'terminal')).toBe(true);
  });
});
