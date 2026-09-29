import { useState } from 'react';
import type { ApprovalDecision } from '../../lib/agent-events';

export type PermissionDockItem = {
  id: string;
  title: string;
  detail: string;
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
      className="border-t border-status-approval/40 bg-status-approval/10 px-3 py-2 space-y-2"
      data-testid="permission-dock"
    >
      {permissions.map((perm) => (
        <div key={perm.id} className="space-y-1">
          <p className="text-body text-text font-medium">{perm.title}</p>
          <p className="text-meta text-text-2 whitespace-pre-wrap">{perm.detail}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="px-2.5 py-1 rounded-full border border-border-subtle bg-elevated text-meta hover:bg-hover"
              onClick={() => onReply(perm.id, 'allow_once')}
            >
              Once
            </button>
            <button
              type="button"
              disabled={busy}
              className="px-2.5 py-1 rounded-full border border-border-subtle bg-elevated text-meta hover:bg-hover"
              onClick={() => onReply(perm.id, 'allow_always')}
            >
              Always
            </button>
            <button
              type="button"
              disabled={busy}
              className="px-2.5 py-1 rounded-full border border-status-error/40 text-status-error text-meta hover:bg-status-error/10"
              onClick={() => onReply(perm.id, 'deny')}
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export type QuestionDockItem = {
  id: string;
  prompt: string;
  options: { label: string }[];
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
      className="border-t border-accent/30 bg-accent/5 px-3 py-2 space-y-3"
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
