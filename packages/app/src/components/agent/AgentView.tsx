import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { AgentCatalog } from '@loomria/shared';
import { getPreset } from '@loomria/shared';
import type { SessionRailState } from '../../hooks/useSessionRail';
import { useAgentSession } from '../../hooks/useAgentSession';
import type { ApprovalDecision } from '../../lib/agent-events';
import { mergePaneAndSessionStatus } from '../../lib/display-status';
import {
  openCodeSessionDisplayStatus,
} from '../../lib/sessions/merge-sessions';
import {
  sessionCancelTurn,
  sessionClaudeToChat,
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
import {
  mapApprovalDecisionToPermissionReply,
  pendingPermissionSessionId,
  type OpenCodePermissionReply,
} from '../../lib/opencode/pending-requests';
import { useTranscriptViewModel } from '../../lib/transcript/use-transcript-view-model';
import { useSelectedSession } from '../../lib/shell-data';
import { useShellSelection } from '../../lib/shell-selection-context';
import { useSessionActions } from '../../lib/sessions/session-actions-context';
import { getOpenCodeStore } from '../../lib/opencode/store';
import { useOpenCodeLastRequestError } from '../../lib/opencode/hooks';
import { tauri } from '../../lib/tauri';
import {
  clearTuiCompanion,
  getTuiCompanion,
  setTuiCompanion,
  useTuiCompanions,
} from '../../lib/tui-companions';
import { answerClaudeTrustPrompt, useClaudeTrustPrompt } from '../../lib/claude-trust-prompt';
import { answerDecision, questionsFromApproval } from '../../lib/protocol-questions';
import { useAgentControls } from '../../hooks/useAgentControls';
import { ClaudeControlBar } from './ClaudeControlBar';
import { PlanApprovalCard } from './PlanApprovalCard';
import { disposeTerminalSession } from '../../terminal/terminal-session-registry';
import { setSessionMuted } from '../../lib/session-notify-prefs';
import { formatPaneSubtitle } from '../../lib/session-subtitle';
import { DisplayStatusDot } from '../DisplayStatusDot';
import { AgentComposerPanel } from '../composer/AgentComposerPanel';
import { capabilitiesForAgentType, agentFamily } from '../../lib/agent-capabilities';
import {
  buildPermissionDockItems,
  PermissionDock,
  type PermissionDockItem,
} from '../opencode/PermissionDock';
import { QuestionDock, type QuestionDockItem } from '../opencode/QuestionDock';
import { TranscriptView } from '../transcript/TranscriptView';
import { useAgentApprovalShortcuts } from './AgentView.keyboard';
import { AgentMark } from './AgentMark';
import { buildProtocolQuestionDockItems } from './question-dock-items';

/**
 * Claude has no server to share, so a terminal is a second process on the same session and drifts from
 * the chat. The chat is the Claude surface; the terminal toggle stays off until it can mirror the chat.
 */
const SHOW_CLAUDE_TUI_TOGGLE = true;
const NOOP_PATCH = () => {};

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
  agentType,
}: {
  paneId: string;
  agentCatalog: AgentCatalog;
  agentType?: string | null;
  paneStatus?: string;
  sessionState?: SessionRailState | null;
  paneTitle?: string | null;
  headlessClaude?: boolean;
  showTui: boolean;
  chatWidthPercent?: number;
  onToggleTui: () => void;
  onExitWorkspace?: () => void;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  embedded?: boolean;
  paneCwd?: string | null;
}) {
  const { selectedSessionId } = useShellSelection();
  const shellSession = useSelectedSession();
  const sessionActions = useSessionActions();
  const railState = sessionState?.state ?? null;
  const {
    capabilities,
    source,
    timeline,
    envelopes: protocolEnvelopes,
    loading,
    error,
    refresh,
    connecting,
    connectFailed,
    retryConnect,
  } =
    useAgentSession(
    paneId,
    true,
    sessionState?.agent_type ?? undefined,
    railState,
  );

  const resolvedAgentType = agentType ?? sessionState?.agent_type ?? null;
  const openCodePane = resolvedAgentType === 'opencode_native' && source !== 'native_tui';
  const store = openCodePane ? getOpenCodeStore(paneId) : null;
  const ocLastRequestErrorRaw = useOpenCodeLastRequestError(paneId);
  const ocLastRequestError = openCodePane ? ocLastRequestErrorRaw : null;
  const ocState = useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    () => (store ? store.getState() : null),
    () => null,
  );
  const sessionId = openCodePane
    ? (selectedSessionId ??
        shellSession?.sessionId ??
        ocState?.sessionOrder[0] ??
        null)
    : null;

  const transcript = useTranscriptViewModel(
    paneId,
    true,
    openCodePane,
    source,
    timeline,
    sessionId,
  );
  const messagesLoading =
    openCodePane &&
    Boolean(sessionId) &&
    ocState?.loadingMessagesSessionId === sessionId &&
    transcript.turns.length === 0;

  const pendingProtocol = timeline.pendingApprovals;
  const pendingPermissions = useMemo(() => {
    if (ocState) return Object.values(ocState.permissions);
    return [];
  }, [ocState]);

  const permissionDockItems = useMemo(
    (): PermissionDockItem[] =>
      buildPermissionDockItems({
        isOpenCodePane: openCodePane,
        sessionId,
        pendingPermissions,
        pendingProtocolApprovals: pendingProtocol,
        family: agentFamily(resolvedAgentType),
      }),
    [openCodePane, pendingPermissions, pendingProtocol, sessionId, resolvedAgentType],
  );

  const protocolQuestions = useMemo(
    () =>
      pendingProtocol
        .map((approval) => ({ approval, questions: questionsFromApproval(approval) }))
        .filter((entry) => entry.questions.length > 0),
    [pendingProtocol],
  );

  const questionDockItems = useMemo((): QuestionDockItem[] => {
    const protocolItems = buildProtocolQuestionDockItems(protocolQuestions, protocolEnvelopes);
    if (!ocState || !sessionId) return protocolItems;
    const openCodeItems = Object.values(ocState.questions)
      .filter((entry) => entry.sessionID === sessionId)
      .map((entry) => ({
        id: entry.id,
        questions: entry.questions,
        submitting: Boolean(entry.submitting),
      }));
    return [...openCodeItems, ...protocolItems];
  }, [ocState, protocolEnvelopes, protocolQuestions, sessionId]);

  const displayStatus = useMemo(() => {
    if (openCodePane && sessionId && ocState) {
      return openCodeSessionDisplayStatus(ocState, sessionId).status;
    }
    return mergePaneAndSessionStatus(paneStatus, railState);
  }, [ocState, openCodePane, paneStatus, railState, sessionId]);

  const displayStatusLabel = useMemo(() => {
    if (openCodePane && sessionId && ocState) {
      return openCodeSessionDisplayStatus(ocState, sessionId).label;
    }
    return undefined;
  }, [ocState, openCodePane, sessionId]);
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
  const tuiCompanions = useTuiCompanions();
  const claudeTuiPaneId = headlessClaude ? tuiCompanions[paneId] : undefined;
  const claudeTrustPrompt = useClaudeTrustPrompt(claudeTuiPaneId);
  const trustClaudeFolder = useCallback(async () => {
    if (!claudeTuiPaneId) return;
    setActionError(null);
    try {
      await answerClaudeTrustPrompt(claudeTuiPaneId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [claudeTuiPaneId]);

  const permissionDockBusy =
    busy || permissionDockItems.some((item) => item.submitting);
  const questionDockBusy =
    busy || questionDockItems.some((item) => item.submitting);

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

  const mapPermissionReplyToApproval = useCallback((reply: OpenCodePermissionReply): ApprovalDecision => {
    switch (reply) {
      case 'once':
        return 'allow_once';
      case 'always':
        return 'allow_always';
      case 'reject':
        return 'deny';
      default: {
        const _exhaustive: never = reply;
        return _exhaustive;
      }
    }
  }, []);

  const respondApproval = useCallback(
    async (approvalId: string, decision: ApprovalDecision) => {
      setBusy(true);
      setActionError(null);
      try {
        if (pendingPermissions.some((p) => p.id === approvalId)) {
          await replyOpenCodePermission(
            paneId,
            approvalId,
            mapApprovalDecisionToPermissionReply(decision),
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

  const agentControls = useAgentControls({
    paneId,
    family: agentFamily(resolvedAgentType),
    protocol: Boolean(headlessClaude) && source === 'protocol',
    onError: setActionError,
    disabledReason: claudeTuiPaneId ? 'Switch back to chat to change this' : undefined,
  });
  const claudeInfo = agentControls.claudeInfo ?? null;
  const updateClaudeInfo = agentControls.patchClaudeInfo ?? NOOP_PATCH;

  const pendingPlan = useMemo(
    () => pendingProtocol.find((approval) => approval.kind === 'plan') ?? null,
    [pendingProtocol],
  );
  const answerPlan = useCallback(
    async (approvalId: string, decision: 'allow_once' | 'deny') => {
      setBusy(true);
      setActionError(null);
      try {
        await sessionRespondApproval(paneId, approvalId, decision);
        if (decision === 'allow_once') updateClaudeInfo({ permissionMode: 'default' });
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [paneId, refresh, updateClaudeInfo],
  );

  const answerProtocolQuestion = useCallback(
    async (approvalId: string, decision: string) => {
      setBusy(true);
      setActionError(null);
      try {
        await sessionRespondApproval(paneId, approvalId, decision);
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [paneId, refresh],
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

  // One owner at a time: either this chat's process or the terminal owns the Claude session. The
  // terminal is a hidden companion pane; handing over stops the other process, so the two cannot drift.
  const terminalOwns = Boolean(claudeTuiPaneId);
  const toggleClaudeTui = useCallback(async () => {
    setActionError(null);
    const working = displayStatus === 'working';
    try {
      if (terminalOwns) {
        if (working && !window.confirm('Claude is still working in the terminal. Stop it and go back to chat?')) {
          return;
        }
        const old = clearTuiCompanion(paneId);
        if (old) disposeTerminalSession(old);
        await sessionClaudeToChat(paneId, old);
        if (showTui) onToggleTui();
        return;
      }
      if (working && !window.confirm('Claude is still working. Stop it and open the terminal?')) {
        return;
      }
      if (working) await sessionCancelTurn(paneId).catch(() => undefined);
      setTuiCompanion(paneId, await sessionOpenInTui(paneId));
      if (!showTui) onToggleTui();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [displayStatus, onToggleTui, paneId, showTui, terminalOwns]);

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

  // While the protocol chat is still connecting (or failed to), source is `native_tui`, which would
  // otherwise hide the composer. Keep it visible and only block submit.
  const composerDisabled =
    (!capabilities.send_prompt && !openCodePane) || connecting || connectFailed;
  const showComposer = !nativeTuiOnly || connecting || connectFailed;
  const composerReason = connecting
    ? 'Starting the chat...'
    : connectFailed
      ? 'The chat could not connect.'
      : nativeTuiOnly
    ? undefined
    : composerDisabled
      ? 'This session cannot accept prompts from the composer.'
      : undefined;

  const sessionModelHint = useMemo(() => {
    for (let i = transcript.turns.length - 1; i >= 0; i -= 1) {
      const turn = transcript.turns[i];
      if (turn?.role === 'assistant' && turn.meta?.model) {
        return { model: turn.meta.model, provider: turn.meta.provider };
      }
    }
    const session = sessionId ? ocState?.sessions[sessionId] : undefined;
    const sessionModel = session && typeof session === 'object' ? session.model : undefined;
    const model =
      sessionModel && typeof sessionModel === 'object'
        ? (sessionModel as { id?: string; providerID?: string })
        : undefined;
    if (model?.id) {
      return { model: model.id, provider: model.providerID };
    }
    return null;
  }, [ocState?.sessions, sessionId, transcript.turns]);

  return (
    <div
      className={`flex flex-col min-h-0 h-full bg-surface border-border-subtle lr-agent-panel ${
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
        <AgentMark family={agentFamily(resolvedAgentType)} size="md" />
        <DisplayStatusDot
          status={displayStatus}
          pulse={displayStatus === 'needs_approval' || displayStatus === 'waiting'}
        />
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium truncate">{agentLabel}</div>
          <div className="text-meta text-text-3 truncate">
            {openCodePane && displayStatus !== 'idle' && displayStatusLabel
              ? displayStatusLabel
              : formatPaneSubtitle(paneId, agentLabel, paneCwd)}
          </div>
        </div>
        {headlessClaude && SHOW_CLAUDE_TUI_TOGGLE && (
          <button
            type="button"
            className="px-2 py-1 text-meta rounded-md border border-border-subtle hover:bg-hover"
            onClick={() => void toggleClaudeTui()}
          >
            {terminalOwns ? 'Back to chat' : 'Open in terminal'}
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
        {!embedded && onExitWorkspace && (
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
        className={`flex flex-1 flex-col min-h-0 overflow-hidden w-full mx-auto ${showTui ? '' : 'max-w-[52rem]'}`}
      >
        {connectFailed && (
          <div
            className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-status-error/30"
            data-testid="agent-connect-failed"
          >
            <p className="text-meta text-status-error flex-1 min-w-0">
              This agent chat could not connect. You can retry, or use Show TUI.
            </p>
            <button
              type="button"
              className="shrink-0 text-meta px-2 py-0.5 rounded border border-border-subtle hover:bg-hover"
              onClick={retryConnect}
            >
              Retry
            </button>
          </div>
        )}
        {claudeTrustPrompt && (
          <div
            className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-elevated"
            data-testid="claude-trust-banner"
          >
            <p className="text-meta flex-1 min-w-0">
              Claude asks whether you trust this folder{paneCwd ? `: ${paneCwd}` : ''}. It can read, edit and
              run files here.
            </p>
            <button
              type="button"
              className="shrink-0 text-meta px-2 py-1 rounded-md bg-accent text-white hover:opacity-90"
              onClick={() => void trustClaudeFolder()}
            >
              Trust folder
            </button>
          </div>
        )}
        {(loading || messagesLoading || error || actionError || ocLastRequestError) && (
          <div className="shrink-0">
            {(loading || messagesLoading) && (
              <p className="text-meta text-text-3 px-3 py-2">
                {messagesLoading ? 'Loading messages…' : 'Loading session…'}
              </p>
            )}
            {(error || actionError || ocLastRequestError) && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-status-error/30">
                <p className="text-meta text-status-error flex-1 min-w-0">
                  {actionError ?? ocLastRequestError ?? error}
                </p>
                {openCodePane && sessionId && ocLastRequestError && store && (
                  <button
                    type="button"
                    className="shrink-0 text-meta px-2 py-0.5 rounded border border-border-subtle hover:bg-hover"
                    onClick={() => void store.ensureSessionMessages(sessionId, { force: true })}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex-1 min-h-[160px] flex flex-col overflow-hidden">
          <TranscriptView
            vm={transcript}
            nativeTuiOnly={nativeTuiOnly}
            projectRoot={paneCwd ?? null}
            onForkFromMessage={
              openCodePane && sessionId
                ? (messageId) => {
                    void sessionActions.forkAt(paneId, sessionId, messageId);
                  }
                : undefined
            }
          />
        </div>

        {showComposer && (
          <div className="shrink-0 flex flex-col min-h-0 border-t border-border-subtle/50">
            <div
              className="flex flex-col min-h-0 max-h-[40vh] overflow-y-auto"
              data-testid="agent-dock-scroll"
            >
              <PermissionDock
                permissions={permissionDockItems}
                busy={permissionDockBusy}
                lastRequestError={ocLastRequestError}
                onReply={(id, reply) => void respondApproval(id, mapPermissionReplyToApproval(reply))}
              />
              <QuestionDock
                questions={questionDockItems}
                busy={questionDockBusy}
                lastRequestError={ocLastRequestError}
                onReply={(id, answers) => {
                  const protocol = protocolQuestions.find((entry) => entry.approval.id === id);
                  if (protocol) {
                    void answerProtocolQuestion(id, answerDecision(protocol.questions, answers));
                    return;
                  }
                  void replyOpenCodeQuestion(paneId, id, answers).then(() => refresh());
                }}
                onReject={(id) => {
                  if (protocolQuestions.some((entry) => entry.approval.id === id)) {
                    void answerProtocolQuestion(id, 'deny');
                    return;
                  }
                  void rejectOpenCodeQuestion(paneId, id).then(() => refresh());
                }}
              />
              {pendingPlan && (
                <PlanApprovalCard
                  plan={pendingPlan.detail}
                  busy={busy}
                  onApprove={() => void answerPlan(pendingPlan.id, 'allow_once')}
                  onKeepPlanning={() => void answerPlan(pendingPlan.id, 'deny')}
                />
              )}
              {headlessClaude && source === 'protocol' && (
                <ClaudeControlBar info={claudeInfo} />
              )}
            </div>
            <AgentComposerPanel
              paneId={paneId}
              sessionId={sessionId}
              openCode={Boolean(openCodePane)}
              capabilities={capabilities}
              agentCapabilities={capabilitiesForAgentType(resolvedAgentType)}
              disabled={composerDisabled}
              disabledReason={composerReason}
              busy={busy}
              showStop={Boolean((capabilities.cancel && transcript.turnActive) || transcript.sessionBusy)}
              sessionModel={sessionModelHint}
              controls={agentControls}
              usage={timeline.usage}
              agentType={resolvedAgentType}
              onSendProtocol={send}
              onCancelProtocol={cancelTurn}
              onError={setActionError}
            />
          </div>
        )}
        {!showComposer && (
          <div
            className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-border-subtle/50"
            data-testid="agent-native-tui-notice"
          >
            <p className="text-meta text-text-3 flex-1 min-w-0">
              This session runs in the terminal. Chat input is unavailable here.
            </p>
            {headlessClaude && SHOW_CLAUDE_TUI_TOGGLE ? (
              <button
                type="button"
                className="shrink-0 text-meta px-2 py-0.5 rounded border border-border-subtle hover:bg-hover"
                onClick={() => void toggleClaudeTui()}
              >
                {terminalOwns ? 'Back to chat' : 'Open in terminal'}
              </button>
            ) : (
              capabilities.attach_tui &&
              !showTui && (
                <button
                  type="button"
                  className="shrink-0 text-meta px-2 py-0.5 rounded border border-border-subtle hover:bg-hover"
                  onClick={onToggleTui}
                >
                  Show TUI
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
