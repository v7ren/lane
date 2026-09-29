import { useCallback, useState } from 'react';
import type { AgentCatalog } from '@loomria/shared';
import { getPreset } from '@loomria/shared';
import type { SessionRailState } from '../../hooks/useSessionRail';
import { useAgentSession } from '../../hooks/useAgentSession';
import type { ApprovalDecision } from '../../lib/agent-events';
import { mergePaneAndSessionStatus } from '../../lib/display-status';
import { sessionCancelTurn, sessionRespondApproval, sessionSendPrompt } from '../../lib/agent-session';
import { tauri } from '../../lib/tauri';
import { setSessionMuted } from '../../lib/session-notify-prefs';
import { DisplayStatusDot } from '../DisplayStatusDot';
import { AgentComposer } from './AgentComposer';
import { AgentTimeline } from './AgentTimeline';
import { useAgentApprovalShortcuts } from './AgentView.keyboard';

export function AgentView({
  paneId,
  agentCatalog,
  paneStatus,
  sessionState,
  paneTitle,
  showTui,
  chatWidthPercent,
  onToggleTui,
  onExitWorkspace,
  muted,
  onMutedChange,
}: {
  paneId: string;
  agentCatalog: AgentCatalog;
  paneStatus?: string;
  sessionState?: SessionRailState | null;
  paneTitle?: string | null;
  showTui: boolean;
  chatWidthPercent?: number;
  onToggleTui: () => void;
  onExitWorkspace: () => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const railState = sessionState?.state ?? null;
  const { capabilities, source, timeline, loading, error, refresh } = useAgentSession(
    paneId,
    true,
    sessionState?.agent_type ?? undefined,
    railState,
  );

  const displayStatus = mergePaneAndSessionStatus(paneStatus, railState);
  const agentLabel =
    paneTitle ??
    getPreset(agentCatalog, (sessionState?.agent_type as never) ?? 'powershell')?.label ??
    sessionState?.agent_type ??
    'Session';
  const nativeTuiOnly =
    source === 'native_tui' ||
    (!capabilities.chat &&
      !capabilities.send_prompt &&
      !capabilities.approvals &&
      capabilities.attach_tui);

  const send = useCallback(
    async (text: string) => {
      setBusy(true);
      try {
        if (source === 'protocol' && capabilities.send_prompt) {
          await sessionSendPrompt(paneId, text);
        } else {
          await tauri.sendSessionPrompt({ pane_id: paneId, text });
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [capabilities.send_prompt, paneId, refresh, source],
  );

  const respondApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      setBusy(true);
      try {
        if (source === 'protocol' && capabilities.approvals) {
          await sessionRespondApproval(paneId, approvalId, decision);
        } else if (decision === 'deny') {
          await tauri.replyOpenCodePermission({ pane_id: paneId, request_id: approvalId, reply: 'deny' });
        } else {
          await tauri.replyOpenCodePermission({
            pane_id: paneId,
            request_id: approvalId,
            reply: decision === 'allow_always' ? 'always' : 'once',
          });
        }
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [capabilities.approvals, paneId, refresh, source],
  );

  const cancelTurn = useCallback(async () => {
    if (!capabilities.cancel) return;
    setBusy(true);
    try {
      await sessionCancelTurn(paneId);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [capabilities.cancel, paneId, refresh]);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    await setSessionMuted(paneId, next);
    onMutedChange(next);
  }, [muted, onMutedChange, paneId]);

  const topApprovalId = timeline.pendingApprovals[0]?.id ?? null;
  useAgentApprovalShortcuts(
    Boolean(topApprovalId),
    topApprovalId,
    () => {
      if (topApprovalId) void respondApproval(topApprovalId, 'allow_once');
    },
    () => {
      if (topApprovalId) void respondApproval(topApprovalId, 'deny');
    },
  );

  const composerDisabled = !capabilities.send_prompt && source !== 'opencode_fallback';
  const composerReason = nativeTuiOnly
    ? undefined
    : composerDisabled
      ? 'This session cannot accept prompts from the composer.'
      : undefined;

  return (
    <div
      className={`flex flex-col min-h-0 bg-lr-panel border-lr-border lr-agent-panel shrink-0 ${
        showTui ? 'border-r' : 'flex-1 min-w-0'
      }`}
      style={
        showTui && chatWidthPercent != null
          ? { flex: `0 0 ${chatWidthPercent}%`, maxWidth: '78%', minWidth: '38%' }
          : showTui
            ? { flex: '0 0 60%', maxWidth: '78%', minWidth: '38%' }
            : undefined
      }
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-lr-border shrink-0">
        <DisplayStatusDot status={displayStatus} pulse={displayStatus === 'needs_approval'} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{agentLabel}</div>
          <div className="text-[10px] text-lr-muted truncate font-mono">{paneId.slice(0, 12)}</div>
        </div>
        {capabilities.attach_tui && (
          <button
            type="button"
            className="px-2 py-1 text-xs rounded-md border border-lr-border hover:bg-lr-raised"
            onClick={onToggleTui}
            aria-pressed={showTui}
          >
            {showTui ? 'Hide TUI' : 'Show TUI'}
          </button>
        )}
        <button
          type="button"
          className="px-2 py-1 text-xs rounded-md border border-lr-border hover:bg-lr-raised"
          onClick={() => void toggleMute()}
          aria-label={muted ? 'Unmute notifications' : 'Mute notifications'}
          title={muted ? 'Notifications muted' : 'Mute notifications'}
        >
          {muted ? '🔕' : '🔔'}
        </button>
        <button
          type="button"
          className="px-2 py-1 text-xs rounded-md border border-lr-border hover:bg-lr-raised"
          onClick={onExitWorkspace}
        >
          Workspace
        </button>
      </div>

      {loading && <p className="text-xs text-lr-muted px-3 py-2">Loading session…</p>}
      {error && (
        <p className="text-xs text-lr-err px-3 py-2 border-b border-lr-err/30">{error}</p>
      )}

      <AgentTimeline
        vm={timeline}
        nativeTuiOnly={nativeTuiOnly}
        busy={busy}
        onRespondApproval={(id, d) => void respondApproval(id, d)}
      />

      {!nativeTuiOnly && (
        <AgentComposer
          disabled={composerDisabled}
          disabledReason={composerReason}
          busy={busy}
          showCancel={capabilities.cancel && timeline.turnActive}
          onSend={send}
          onCancel={cancelTurn}
        />
      )}
    </div>
  );
}
