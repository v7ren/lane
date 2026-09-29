import { describe, expect, it } from 'vitest';
import { isEditableKeyboardTarget, isModifierCombo } from './keyboard-target';

describe('keyboard-target', () => {
  it('treats monaco editor as editable', () => {
    const host = document.createElement('div');
    host.className = 'monaco-editor';
    const inner = document.createElement('div');
    host.appendChild(inner);
    document.body.appendChild(host);
    expect(isEditableKeyboardTarget(inner)).toBe(true);
    host.remove();
  });

  it('treats textarea as editable', () => {
    const el = document.createElement('textarea');
    expect(isEditableKeyboardTarget(el)).toBe(true);
  });

  it('detects modifier combos', () => {
    expect(
      isModifierCombo(
        new KeyboardEvent('keydown', { ctrlKey: true, key: 'p' }),
      ),
    ).toBe(true);
    expect(isModifierCombo(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false);
  });
});
