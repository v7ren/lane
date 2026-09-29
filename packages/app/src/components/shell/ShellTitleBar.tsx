import { Plus } from 'lucide-react';

export function ShellTitleBar({ onNewPane }: { onNewPane: () => void }) {
  return (
    <header
      className="h-9 shrink-0 flex items-center border-b border-border-subtle bg-surface px-3 relative"
      data-testid="shell-title-bar"
    >
      <div className="flex-1" />
      <span className="absolute left-1/2 -translate-x-1/2 text-[13px] font-medium tracking-tight text-text lowercase select-none">
        loomria
      </span>
      <div className="flex-1 flex justify-end">
        <button
          type="button"
          onClick={onNewPane}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta text-text-2 hover:text-text hover:bg-hover transition-colors duration-ui"
        >
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          New pane
        </button>
      </div>
    </header>
  );
}

export function EditorTabsSlot() {
  return (
    <div
      className="h-9 shrink-0 border-b border-border-subtle bg-elevated/50 px-3 flex items-center text-meta text-text-3"
      data-testid="editor-tabs-slot"
      aria-hidden
    />
  );
}
