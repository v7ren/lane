import { describe, expect, it } from 'vitest';
import {
  isEditableKeyboardTarget,
  isEditorKeyboardTarget,
  isModifierCombo,
  isTerminalKeyboardTarget,
  shouldIgnoreGlobalShortcut,
} from './keyboard-target';

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

  it('treats xterm helper textarea as terminal target', () => {
    const host = document.createElement('div');
    host.className = 'xterm';
    const textarea = document.createElement('textarea');
    textarea.className = 'xterm-helper-textarea';
    host.appendChild(textarea);
    document.body.appendChild(host);
    expect(isTerminalKeyboardTarget(textarea)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(textarea)).toBe(true);
    host.remove();
  });

  it('detects editor workspace target', () => {
    const root = document.createElement('div');
    root.setAttribute('data-editor-workspace', '');
    const inner = document.createElement('div');
    root.appendChild(inner);
    expect(isEditorKeyboardTarget(inner)).toBe(true);
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
