import type { DiskConflictState } from '../../lib/editor/conflict';

export function ConflictBanner({
  state,
  onCompare,
  onKeepMine,
  onReload,
}: {
  state: DiskConflictState;
  onCompare: () => void;
  onKeepMine: () => void;
  onReload: () => void;
}) {
  if (state.phase === 'idle') return null;
  return (
    <div
      className="shrink-0 px-3 py-2 bg-elevated border-b border-border-subtle text-meta text-text-2 flex items-center justify-between gap-3"
      data-testid="conflict-banner"
    >
      <span>File changed on disk</span>
      <div className="flex items-center gap-2">
        <button type="button" className="px-2 py-0.5 rounded-md hover:bg-hover" onClick={onCompare}>
          Compare
        </button>
        <button type="button" className="px-2 py-0.5 rounded-md hover:bg-hover" onClick={onKeepMine}>
          Keep mine
        </button>
        <button type="button" className="px-2 py-0.5 rounded-md bg-accent/20 text-accent hover:bg-accent/30" onClick={onReload}>
          Reload
        </button>
      </div>
    </div>
  );
}
