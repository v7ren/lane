import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { AgentCatalog } from '@loomria/shared';
import { getPreset } from '@loomria/shared';
import type { SessionRailState } from '../../hooks/useSessionRail';
import { useAgentSession } from '../../hooks/useAgentSession';
import type { ApprovalDecision } from '../../lib/agent-events';
import { mergePaneAndSessionStatus } from '../../lib/display-status';
import {
  sessionCancelTurn,
  sessionOpenInTui,
  sessionRespondApproval,
  sessionSendPrompt,
} from '../../lib/agent-session';
import {
  abortOpenCodeSession,
  rejectOpenCodeQuestion,
  replyOpenCodePermission,
  replyOpenCodeQuestion,
} from '../../lib/commands/agent';
import { useTranscriptViewModel } from '../../lib/transcript/use-transcript-view-model';
import { getOpenCodeStore } from '../../lib/opencode/store';
import { tauri } from '../../lib/tauri';
import { setSessionMuted } from '../../lib/session-notify-prefs';
import { formatPaneSubtitle } from '../../lib/session-subtitle';
import { DisplayStatusDot } from '../DisplayStatusDot';
import { AgentComposerPanel } from '../composer/AgentComposerPanel';
import { PermissionDock, QuestionDock, type PermissionDockItem, type QuestionDockItem } from '../composer/ComposerDocks';
import { TranscriptView } from '../transcript/TranscriptView';
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
  headlessClaude,
  embedded,
  paneCwd,
}: {
  paneId: string;
  agentCatalog: AgentCatalog;
  paneStatus?: string;
  sessionState?: SessionRailState | null;
  paneTitle?: string | null;
  headlessClaude?: boolean;
  showTui: boolean;
  chatWidthPercent?: number;
  onToggleTui: () => void;
  onExitWorkspace: () => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  embedded?: boolean;
  paneCwd?: string | null;
}) {
  const railState = sessionState?.state ?? null;
  const { capabilities, source, timeline, loading, error, refresh } = useAgentSession(
    paneId,
    true,
    sessionState?.agent_type ?? undefined,
    railState,
  );

  const transcript = useTranscriptViewModel(
    paneId,
    true,
    sessionState?.agent_type ?? undefined,
    source,
    timeline,
  );

  const openCodePane = sessionState?.agent_type === 'opencode_native' && source !== 'native_tui';
  const store = openCodePane ? getOpenCodeStore(paneId) : null;
  const ocState = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    () => (store ? store.getState() : null),
    () => null,
  );
  const sessionId = ocState?.sessionOrder[0] ?? null;

  const pendingProtocol = timeline.pendingApprovals;
  const pendingPermissions = useMemo(() => {
    if (ocState) return Object.values(ocState.permissions);
    return [];
  }, [ocState]);

  const pendingQuestions = useMemo(() => {
    if (ocState) return Object.values(ocState.questions);
    return [];
  }, [ocState]);

  const permissionDockItems = useMemo((): PermissionDockItem[] => {
    const fromStore = pendingPermissions.map((perm) => {
      const raw = perm as Record<string, unknown>;
      const data = raw.data as Record<string, unknown> | undefined;
      return {
        id: String(raw.id ?? ''),
        title: String(data?.title ?? raw.title ?? 'Permission required'),
        detail: String(data?.pattern ?? data?.command ?? raw.pattern ?? ''),
      };
    });
    if (fromStore.length > 0) return fromStore;
    return pendingProtocol.map((a) => ({
      id: a.id,
      title: a.title,
      detail: a.detail,
    }));
  }, [pendingPermissions, pendingProtocol]);

  const questionDockItems = useMemo((): QuestionDockItem[] => {
    return pendingQuestions.map((q) => {
      const raw = q as Record<string, unknown>;
      const first = (raw.questions as { question?: string; options?: { label: string }[] }[] | undefined)?.[0];
      return {
        id: String(raw.id ?? ''),
        prompt: first?.question ?? 'Question',
        options: first?.options ?? [],
      };
    });
  }, [pendingQuestions]);

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

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string) => {
      setBusy(true);
      setActionError(null);
      try {
        if (source === 'protocol' && capabilities.send_prompt) {
          await sessionSendPrompt(paneId, text);
        } else {
          await tauri.sendSessionPrompt({ pane_id: paneId, text });
        }
        await refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setActionError(message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [capabilities.send_prompt, paneId, refresh, source],
  );

  const respondApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      setBusy(true);
      setActionError(null);
      try {
        if (pendingPermissions.some((p) => p.id === approvalId)) {
          await replyOpenCodePermission(
            paneId,
            approvalId,
            decision === 'deny' ? 'reject' : decision === 'allow_always' ? 'always' : 'once',
          );
        } else if (source === 'protocol' && capabilities.approvals) {
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setActionError(message);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [capabilities.approvals, paneId, pendingPermissions, refresh, source],
  );

  const cancelTurn = useCallback(async () => {
    if (!capabilities.cancel && !(openCodePane && sessionId)) return;
    setBusy(true);
    setActionError(null);
    try {
      if (openCodePane && sessionId) {
        await abortOpenCodeSession(paneId, sessionId);
      } else {
        await sessionCancelTurn(paneId);
      }
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setActionError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [capabilities.cancel, openCodePane, paneId, refresh, sessionId]);

  const toggleMute = useCallback(async () => {
    const next = !muted;
    await setSessionMuted(paneId, next);
    onMutedChange(next);
  }, [muted, onMutedChange, paneId]);

  const topApprovalId = permissionDockItems[0]?.id ?? null;
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

  const composerDisabled = !capabilities.send_prompt && !openCodePane;
  const composerReason = nativeTuiOnly
    ? undefined
    : composerDisabled
      ? 'This session cannot accept prompts from the composer.'
      : undefined;

  return (
    <div
      className={`flex flex-col min-h-0 bg-surface border-border-subtle lr-agent-panel ${
        showTui ? 'shrink-0 border-r' : 'flex-1 min-w-0 w-full z-[1]'
      }`}
      style={
        showTui && chatWidthPercent != null
          ? { flex: `0 0 ${chatWidthPercent}%`, maxWidth: '78%', minWidth: '38%' }
          : showTui
            ? { flex: '0 0 60%', maxWidth: '78%', minWidth: '38%' }
            : undefined
      }
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle shrink-0 w-full">
        <DisplayStatusDot status={displayStatus} pulse={displayStatus === 'needs_approval'} />
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium truncate">{agentLabel}</div>
          <div className="text-meta text-text-3 truncate">
            {formatPaneSubtitle(paneId, agentLabel, paneCwd)}
          </div>
        </div>
        {headlessClaude && (
          <button
            type="button"
            className="px-2 py-1 text-meta rounded-md border border-border-subtle hover:bg-hover"
            onClick={() => void sessionOpenInTui(paneId)}
          >
            Open in TUI
          </button>
        )}
        {capabilities.attach_tui && !showTui && !headlessClaude && (
          <button
            type="button"
            className="px-2 py-1 text-meta rounded-md border border-border-subtle hover:bg-hover"
            onClick={onToggleTui}
          >
            Show TUI
          </button>
        )}
        <button
          type="button"
          className="px-2 py-1 text-meta rounded-md border border-border-subtle hover:bg-hover"
          onClick={() => void toggleMute()}
          aria-label={muted ? 'Unmute notifications' : 'Mute notifications'}
        >
          {muted ? '🔕' : '🔔'}
        </button>
        {!embedded && (
          <button
            type="button"
            className="px-2 py-1 text-meta rounded-md border border-border-subtle hover:bg-hover"
            onClick={onExitWorkspace}
          >
            Workspace
          </button>
        )}
      </div>

      <div
        className={`flex flex-1 flex-col min-h-0 w-full mx-auto ${showTui ? '' : 'max-w-[52rem]'}`}
      >
        {loading && <p className="text-meta text-text-3 px-3 py-2">Loading session…</p>}
        {(error || actionError) && (
          <p className="text-meta text-status-error px-3 py-2 border-b border-status-error/30">
            {actionError ?? error}
          </p>
        )}

        <TranscriptView vm={transcript} nativeTuiOnly={nativeTuiOnly} />

        {!nativeTuiOnly && (
          <>
            <PermissionDock
              permissions={permissionDockItems}
              busy={busy}
              onReply={(id, d) => void respondApproval(id, d)}
            />
            <QuestionDock
              questions={questionDockItems}
              busy={busy}
              onReply={(id, answer) => {
                void replyOpenCodeQuestion(paneId, id, answer).then(() => refresh());
              }}
              onReject={(id) => {
                void rejectOpenCodeQuestion(paneId, id).then(() => refresh());
              }}
            />
            <AgentComposerPanel
              paneId={paneId}
              sessionId={sessionId}
              openCode={Boolean(openCodePane)}
              capabilities={capabilities}
              disabled={composerDisabled}
              disabledReason={composerReason}
              busy={busy}
              showStop={Boolean((capabilities.cancel && transcript.turnActive) || transcript.sessionBusy)}
              onSendProtocol={send}
              onCancelProtocol={cancelTurn}
              onError={setActionError}
            />
          </>
        )}
      </div>
    </div>
  );
}
