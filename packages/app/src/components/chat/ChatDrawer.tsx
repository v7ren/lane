import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionRailState } from '../../hooks/useSessionRail';
import { useOpenCodeChat } from '../../hooks/useOpenCodeChat';
import {
  flattenMessageText,
  type MessageView,
  type PendingQuestion,
} from '../../lib/opencode-chat';
import { escapeAgentText } from '../../lib/safe-agent-text';
import { tauri } from '../../lib/tauri';

const STATE_LABEL: Record<string, string> = {
  working: 'Working…',
  needs_approval: 'Needs your input',
  idle: 'Idle',
  done: 'Done',
  error: 'Error',
  rate_limited: 'Rate limited',
};

function StatusPill({ state, detail }: { state?: string | null; detail?: string | null }) {
  if (!state) return null;
  const tone =
    state === 'working'
      ? 'border-amber-500/40 text-amber-200 bg-amber-500/10'
      : state === 'needs_approval'
        ? 'border-sky-500/40 text-sky-200 bg-sky-500/10'
        : state === 'error'
          ? 'border-red-500/40 text-red-200 bg-red-500/10'
          : 'border-pm-border text-pm-muted bg-pm-bg/50';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] ${tone}`}
      title={detail ?? undefined}
    >
      {state === 'working' && (
        <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" aria-hidden />
      )}
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

function ChatBubble({ message }: { message: MessageView }) {
  const role = message.role.toLowerCase();
  const isUser = role === 'user';
  const text = flattenMessageText(message);
  if (!text) return null;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[92%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-pm-ok/15 text-pm-ok border border-pm-ok/25'
            : 'bg-pm-bg text-pm-text border border-pm-border'
        }`}
      >
        {!isUser && (
          <div className="text-[10px] uppercase tracking-wide text-pm-muted mb-0.5">Assistant</div>
        )}
        {escapeAgentText(text)}
        {message.finish && (
          <div className="mt-1 text-[10px] text-pm-muted">finish: {message.finish}</div>
        )}
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  busy,
  onAnswer,
}: {
  question: PendingQuestion;
  busy: boolean;
  onAnswer: (label: string) => void;
}) {
  return (
    <div className="rounded-lg border border-sky-500/35 bg-sky-500/10 p-2.5 space-y-2 shadow-sm">
      <div className="text-[11px] font-medium text-sky-100">Agent question</div>
      <p className="text-xs text-pm-text whitespace-pre-wrap">{escapeAgentText(question.question)}</p>
      <div className="flex flex-wrap gap-1.5">
        {question.options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            disabled={busy}
            title={opt.description ?? undefined}
            className="px-2.5 py-1 text-xs rounded-md border border-sky-400/40 bg-pm-panel hover:bg-sky-500/20 disabled:opacity-50"
            onClick={() => onAnswer(opt.label)}
          >
            {escapeAgentText(opt.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

function PermissionCard({
  requestId,
  busy,
  onReply,
}: {
  requestId: string;
  busy: boolean;
  onReply: (reply: 'once' | 'always' | 'deny') => void;
}) {
  return (
    <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-2.5 space-y-2">
      <div className="text-[11px] font-medium text-amber-100">Permission required</div>
      <p className="text-[11px] text-pm-muted font-mono truncate" title={requestId}>
        {requestId}
      </p>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          className="px-2.5 py-1 text-xs rounded-md border border-pm-border bg-pm-panel hover:bg-pm-bg"
          onClick={() => onReply('once')}
        >
          Allow once
        </button>
        <button
          type="button"
          disabled={busy}
          className="px-2.5 py-1 text-xs rounded-md border border-pm-border bg-pm-panel hover:bg-pm-bg"
          onClick={() => onReply('always')}
        >
          Always allow
        </button>
        <button
          type="button"
          disabled={busy}
          className="px-2.5 py-1 text-xs rounded-md border border-red-500/40 text-red-200 hover:bg-red-500/15"
          onClick={() => onReply('deny')}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

export function ChatDrawer({
  paneId,
  open,
  sessionState,
  onClose,
}: {
  paneId: string | null;
  open: boolean;
  sessionState?: SessionRailState | null;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stateKey = sessionState?.state ?? null;

  const { view, permissions, error, refreshing, refresh } = useOpenCodeChat(
    paneId,
    open,
    stateKey,
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [view?.messages.length, view?.pending_question?.request_id, permissions.length]);

  const send = useCallback(async () => {
    if (!paneId || !draft.trim()) return;
    setBusy(true);
    setSendError(null);
    const text = draft.trim();
    setDraft('');
    try {
      await tauri.sendSessionPrompt({ pane_id: paneId, text });
      await refresh();
    } catch (err) {
      setDraft(text);
      setSendError(String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, paneId, refresh]);

  const answerQuestion = useCallback(
    async (label: string) => {
      if (!paneId || !view?.pending_question) return;
      setBusy(true);
      try {
        await tauri.replyOpenCodeQuestion({
          pane_id: paneId,
          answer: label,
          request_id: view.pending_question.request_id ?? undefined,
        });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [paneId, refresh, view?.pending_question],
  );

  const replyPermission = useCallback(
    async (requestId: string, reply: 'once' | 'always' | 'deny') => {
      if (!paneId) return;
      setBusy(true);
      try {
        await tauri.replyOpenCodePermission({ pane_id: paneId, request_id: requestId, reply });
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [paneId, refresh],
  );

  if (!open || !paneId) return null;

  const messages = view?.messages ?? [];
  const pending = view?.pending_question;

  return (
    <aside className="w-[min(28rem,42vw)] border-l border-pm-border bg-pm-panel flex flex-col shrink-0 min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-pm-border">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs font-medium truncate">Agent chat</span>
          <span className="text-[10px] font-mono text-pm-muted truncate">{paneId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill state={stateKey} detail={sessionState?.detail} />
          {refreshing && <span className="text-[10px] text-pm-muted">sync</span>}
          <button type="button" className="text-xs text-pm-muted hover:text-pm-text" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 min-h-0">
        {(error || sendError) && (
          <div className="text-xs text-red-300 border border-red-500/30 rounded p-2">
            {error ?? sendError}
          </div>
        )}
        {messages.length === 0 && !pending && !error && (
          <p className="text-xs text-pm-muted">
            Send a message below. Assistant replies and approval prompts appear here (not in the TUI
            scrollback).
          </p>
        )}
        {messages.map((message, index) => (
          <ChatBubble key={message.id ?? `m-${index}`} message={message} />
        ))}
        {pending && (
          <QuestionCard question={pending} busy={busy} onAnswer={(label) => void answerQuestion(label)} />
        )}
        {permissions.map((perm) => (
          <PermissionCard
            key={perm.id}
            requestId={perm.id}
            busy={busy}
            onReply={(reply) => void replyPermission(perm.id, reply)}
          />
        ))}
      </div>

      <div className="p-2 border-t border-pm-border flex gap-1.5 bg-pm-panel/90">
        <textarea
          className="flex-1 text-xs px-2 py-1.5 rounded border border-pm-border bg-pm-bg resize-none min-h-[2.5rem] max-h-32"
          rows={2}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Message agent (OpenCode API)…"
        />
        <button
          type="button"
          disabled={busy || !draft.trim()}
          className="px-3 py-1 text-xs rounded border border-pm-border self-end disabled:opacity-40"
          onClick={() => void send()}
        >
          Send
        </button>
      </div>
    </aside>
  );
}
