/** True when the event target is typing UI; global single-key shortcuts should not steal focus. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('.monaco-editor')) return true;
  if (target.closest('.xterm')) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** True when focus is inside an xterm.js terminal (including its helper textarea). */
export function isTerminalKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('.xterm'));
}

/** Global shortcuts should not run while the user is interacting with a terminal surface. */
export function shouldIgnoreGlobalShortcut(target: EventTarget | null): boolean {
  return isTerminalKeyboardTarget(target);
}

/** Global shortcuts that only use modifiers (Ctrl/Cmd/Alt) may run from editable fields. */
export function isModifierCombo(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

/** True when the editor workspace (tabs / monaco) owns focus — not the agent composer alone. */
export function isEditorKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('[data-editor-workspace]'));
}
