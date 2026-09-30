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

