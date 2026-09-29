import { useEffect } from 'react';

export function useAgentApprovalShortcuts(
  enabled: boolean,
  topApprovalId: string | null,
  onApprove: () => void,
  onDeny: () => void,
) {
  useEffect(() => {
    if (!enabled || !topApprovalId) return;
    const onKey = (e: KeyboardEvent) => {
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
