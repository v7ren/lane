import { useEffect } from 'react';
import type { SessionRailState } from './useSessionRail';
import { useAppKeyboard } from './useAppKeyboard';
import {
  isEditableKeyboardTarget,
  isModifierCombo,
  shouldIgnoreGlobalShortcut,
} from './keyboard-target';
import { matchesAction } from '../lib/keybinds';

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
  onToggleUiMode,
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
  onToggleUiMode?: () => void;
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
      if (shouldIgnoreGlobalShortcut(e.target)) return;
      if (!isModifierCombo(e) && isEditableKeyboardTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (matchesAction(e, 'palette')) {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      if (matchesAction(e, 'files')) {
        e.preventDefault();
        onOpenFilePalette();
        return;
      }
      if (matchesAction(e, 'bottom')) {
        e.preventDefault();
        onToggleBottom();
        return;
      }
      if (onToggleUiMode && matchesAction(e, 'uiMode')) {
        e.preventDefault();
        onToggleUiMode();
        return;
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        onToggleSidebar();
        return;
      }
      if (matchesAction(e, 'newAgent')) {
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
    onToggleUiMode,
  ]);
}
