import { useEffect } from 'react';
import type { SessionRailState } from './useSessionRail';
import {
  isEditableKeyboardTarget,
  isModifierCombo,
  shouldIgnoreGlobalShortcut,
} from './keyboard-target';
import { DISPLAY_STATUS_ORDER, mergePaneAndSessionStatus } from '../lib/display-status';
import type { AppMode } from './useWorkspaceMode';
import type { ApprovalDecision } from '../lib/agent-events';

export function useAppKeyboard({
  mode,
  sessionStates,
  agentPaneId,
  onToggleMode,
  onJumpApproval,
  onApproveTop,
  onDenyTop,
}: {
  mode: AppMode;
  sessionStates: Map<string, SessionRailState>;
  agentPaneId: string | null;
  onToggleMode: () => void;
  onJumpApproval: (paneId: string) => void;
  onApproveTop: (paneId: string, approvalId: string) => void;
  onDenyTop: (paneId: string, approvalId: string) => void;
  topApprovalId?: string | null;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcut(e.target)) return;
      if (!isModifierCombo(e) && isEditableKeyboardTarget(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === '`') {
        e.preventDefault();
        onToggleMode();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a' && mode === 'agent' && agentPaneId) {
        e.preventDefault();
        const approvalId = findFirstApproval(sessionStates, agentPaneId);
        if (approvalId) onApproveTop(agentPaneId, approvalId);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'd' && mode === 'agent' && agentPaneId) {
        e.preventDefault();
        const approvalId = findFirstApproval(sessionStates, agentPaneId);
        if (approvalId) onDenyTop(agentPaneId, approvalId);
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        const next = findNextNeedsApproval(sessionStates, agentPaneId);
        if (next) {
          e.preventDefault();
          onJumpApproval(next);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agentPaneId, mode, onApproveTop, onDenyTop, onJumpApproval, onToggleMode, sessionStates]);
}

function findNextNeedsApproval(
  states: Map<string, SessionRailState>,
  current: string | null,
): string | null {
  const candidates = [...states.values()]
    .filter((s) => mergePaneAndSessionStatus(null, s.state) === 'needs_approval')
    .sort(
      (a, b) =>
        (DISPLAY_STATUS_ORDER.needs_approval ?? 0) - (DISPLAY_STATUS_ORDER.needs_approval ?? 0) ||
        b.updated_at_ms - a.updated_at_ms,
    );
  if (candidates.length === 0) return null;
  if (!current) return candidates[0].pane_id;
  const idx = candidates.findIndex((c) => c.pane_id === current);
  return candidates[(idx + 1) % candidates.length]?.pane_id ?? candidates[0].pane_id;
}

function findFirstApproval(_states: Map<string, SessionRailState>, _paneId: string): string | null {
  return null;
}

export function approvalDecisionFromShortcut(kind: 'approve' | 'deny'): ApprovalDecision {
  return kind === 'approve' ? 'allow_once' : 'deny';
}
