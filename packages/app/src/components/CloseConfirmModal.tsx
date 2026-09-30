export function CloseConfirmModal({
  agentCount,
  onConfirm,
  onCancel,
}: {
  agentCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const n = agentCount;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      data-testid="close-confirm-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="close-confirm-title"
    >
      <div className="max-w-sm w-full rounded-lg border border-border-subtle bg-surface p-4 shadow-lg">
        <h2 id="close-confirm-title" className="text-sm font-medium text-text mb-2">
          Close Loomria?
        </h2>
        <p className="text-xs text-text-2 mb-4">
          {n} agent session{n === 1 ? '' : 's'} {n === 1 ? 'is' : 'are'} still running. Close the app
          anyway?
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded-md border border-border-subtle hover:bg-hover"
            data-testid="close-confirm-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:opacity-90"
            data-testid="close-confirm-ok"
            onClick={onConfirm}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
