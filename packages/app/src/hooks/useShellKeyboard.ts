import { useEffect } from 'react';
import type { SessionRailState } from './useSessionRail';
import { useAppKeyboard } from './useAppKeyboard';

export function useShellKeyboard({
  sessionStates,
  agentPaneId,
  onNewAgent,
  onToggleBottom,
  onToggleSidebar,
  onOpenPalette,
  onOpenFilePalette,
  onSwitchTerminalTab,
  onJumpApproval,
  onApproveTop,
  onDenyTop,
}: {
  sessionStates: Map<string, SessionRailState>;
  agentPaneId: string | null;
  onNewAgent: () => void;
  onToggleBottom: () => void;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  onOpenFilePalette: () => void;
  onSwitchTerminalTab: () => void;
  onJumpApproval: (paneId: string) => void;
  onApproveTop: () => void;
  onDenyTop: () => void;
}) {
  useAppKeyboard({
    mode: 'agent',
    sessionStates,
    agentPaneId,
    onToggleMode: onSwitchTerminalTab,
    onJumpApproval,
    onApproveTop,
    onDenyTop,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        onOpenFilePalette();
        return;
      }
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        onToggleBottom();
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        onToggleSidebar();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        onNewAgent();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    onNewAgent,
    onOpenFilePalette,
    onOpenPalette,
    onSwitchTerminalTab,
    onToggleBottom,
    onToggleSidebar,
  ]);
}
