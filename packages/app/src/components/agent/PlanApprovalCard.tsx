import { MarkdownBody } from '../transcript/MarkdownBody';

/** A plan Claude finished writing in plan mode, waiting for the user to approve it or keep planning. */
export function PlanApprovalCard({
  plan,
  busy,
  onApprove,
  onKeepPlanning,
}: {
  plan: string;
  busy: boolean;
  onApprove: () => void;
  onKeepPlanning: () => void;
}) {
  return (
    <div
      className="shrink-0 mx-3 mt-2 rounded-lg border border-border-subtle bg-elevated"
      data-testid="plan-approval-card"
    >
      <div className="px-3 pt-2 text-meta font-medium text-text-2">Plan ready for review</div>
      <div className="px-3 py-2 max-h-64 overflow-auto text-body">
        <MarkdownBody markdown={plan} />
      </div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <button
          type="button"
          disabled={busy}
          className="px-3 py-1 rounded-md bg-accent text-white text-meta hover:opacity-90 disabled:opacity-50"
          onClick={onApprove}
        >
          Approve plan
        </button>
        <button
          type="button"
          disabled={busy}
          className="px-3 py-1 rounded-md border border-border-subtle text-meta hover:bg-hover disabled:opacity-50"
          onClick={onKeepPlanning}
        >
          Keep planning
        </button>
      </div>
    </div>
  );
}
