import { useEffect } from 'react';
import { isEditableKeyboardTarget, isModifierCombo } from '../../hooks/keyboard-target';

export function useAgentApprovalShortcuts(
  enabled: boolean,
  topApprovalId: string | null,
  onApprove: () => void,
  onDeny: () => void,
) {
  useEffect(() => {
    if (!enabled || !topApprovalId) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isModifierCombo(e) && isEditableKeyboardTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.shiftKey) return;
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        onApprove();
      }
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        onDeny();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onApprove, onDeny, topApprovalId]);
}
