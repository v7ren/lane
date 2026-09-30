import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ApprovalDecision } from '../../lib/agent-events';

export type PermissionDockItem = {
  id: string;
  title: string;
  detail: string;
  submitting?: boolean;
};

export function PermissionDock({
  permissions,
  busy,
  onReply,
}: {
  permissions: PermissionDockItem[];
  busy: boolean;
  onReply: (id: string, decision: ApprovalDecision) => void;
}) {
  if (permissions.length === 0) return null;
  return (
    <div
      className="border-t border-status-approval/40 bg-status-approval/10 px-2 py-1.5 space-y-1 shrink-0"
      data-testid="permission-dock"
    >
      {permissions.map((perm) => (
        <PermissionDockRow key={perm.id} perm={perm} busy={busy} onReply={onReply} />
      ))}
    </div>
  );
}

function PermissionDockRow({
  perm,
  busy,
  onReply,
}: {
  perm: PermissionDockItem;
  busy: boolean;
  onReply: (id: string, decision: ApprovalDecision) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = perm.title || perm.detail.split('\n')[0] || 'Permission required';
  const hasDetail = perm.detail.trim().length > 0 && perm.detail !== summary;
  return (
    <div className="rounded-md border border-status-approval/30 bg-surface/60">
      <div className="flex items-center gap-2 px-2 py-1.5 min-h-[2rem]">
        {hasDetail ? (
          <button
            type="button"
            className="shrink-0 text-text-3 p-0.5"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <p className="flex-1 min-w-0 text-meta text-text truncate" title={summary}>
          {summary}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={busy}
            className="px-2 py-0.5 rounded-full border border-border-subtle bg-elevated text-[11px] hover:bg-hover"
            onClick={() => onReply(perm.id, 'allow_once')}
          >
            Once
          </button>
          <button
            type="button"
            disabled={busy}
            className="px-2 py-0.5 rounded-full border border-border-subtle bg-elevated text-[11px] hover:bg-hover"
            onClick={() => onReply(perm.id, 'allow_always')}
          >
            Always
          </button>
          <button
            type="button"
            disabled={busy}
            className="px-2 py-0.5 rounded-full border border-status-error/40 text-status-error text-[11px] hover:bg-status-error/10"
            onClick={() => onReply(perm.id, 'deny')}
          >
            Reject
          </button>
        </div>
      </div>
      {expanded && hasDetail && (
        <p className="px-2 pb-2 text-[11px] text-text-2 whitespace-pre-wrap border-t border-border-subtle/50">
          {perm.detail}
        </p>
      )}
    </div>
  );
}

export type QuestionDockItem = {
  id: string;
  prompt: string;
  options: { label: string }[];
  submitting?: boolean;
};

export function QuestionDock({
  questions,
  busy,
  onReply,
  onReject,
}: {
  questions: QuestionDockItem[];
  busy: boolean;
  onReply: (id: string, answer: string) => void;
  onReject: (id: string) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <div
      className="border-t border-accent/30 bg-accent/5 px-3 py-2 space-y-2 shrink-0"
      data-testid="question-dock"
    >
      {questions.map((q) => (
        <QuestionCard key={q.id} question={q} busy={busy} onReply={onReply} onReject={onReject} />
      ))}
    </div>
  );
}

function QuestionCard({
  question,
  busy,
  onReply,
  onReject,
}: {
  question: QuestionDockItem;
  busy: boolean;
  onReply: (id: string, answer: string) => void;
  onReject: (id: string) => void;
}) {
  const [freeText, setFreeText] = useState('');
  return (
    <div className="space-y-2">
      <p className="text-body text-text">{question.prompt}</p>
      <div className="flex flex-wrap gap-2">
        {question.options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            disabled={busy}
            className="px-2.5 py-1 rounded-full border border-border-subtle bg-elevated text-meta hover:bg-hover"
            onClick={() => onReply(question.id, opt.label)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border-subtle bg-surface px-2 py-1 text-body focus:outline-none focus:ring-2 focus:ring-accent/40"
          placeholder="Custom answer"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
        />
        <button
          type="button"
          disabled={busy || !freeText.trim()}
          className="px-3 py-1 rounded-full bg-accent text-white text-meta disabled:opacity-40"
          onClick={() => onReply(question.id, freeText.trim())}
        >
          Send
        </button>
        <button
          type="button"
          disabled={busy}
          className="px-3 py-1 rounded-full border border-border-subtle text-meta hover:bg-hover"
          onClick={() => onReject(question.id)}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
