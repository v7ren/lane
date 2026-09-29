/** True when the event target is typing UI; global single-key shortcuts should not steal focus. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('.monaco-editor')) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** Global shortcuts that only use modifiers (Ctrl/Cmd/Alt) may run from editable fields. */
export function isModifierCombo(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}
