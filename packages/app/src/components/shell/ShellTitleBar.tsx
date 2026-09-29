import { PanelRight, Plus } from 'lucide-react';
import type { RefObject } from 'react';

export function ShellTitleBar({
  newPaneButtonRef,
  onNewPane,
  showRightRailToggle,
  onToggleRightRail,
}: {
  newPaneButtonRef?: RefObject<HTMLButtonElement>;
  onNewPane: () => void;
  showRightRailToggle?: boolean;
  onToggleRightRail?: () => void;
}) {
  return (
    <header
      className="h-[36px] shrink-0 flex items-center border-b border-border-subtle bg-surface px-3 relative"
      data-testid="shell-title-bar"
    >
      <div className="flex-1 flex items-center gap-2">
        {showRightRailToggle && onToggleRightRail && (
          <button
            type="button"
            aria-label="Toggle right panel"
            onClick={onToggleRightRail}
            className="p-1 rounded-md text-text-3 hover:text-text hover:bg-hover"
          >
            <PanelRight size={16} strokeWidth={1.5} />
          </button>
        )}
      </div>
      <span className="absolute left-1/2 -translate-x-1/2 text-body font-medium tracking-tight text-text lowercase select-none">
        loomria
      </span>
      <div className="flex-1 flex justify-end">
        <button
          ref={newPaneButtonRef}
          type="button"
          onClick={onNewPane}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-meta text-text-2 hover:text-text hover:bg-hover transition-colors duration-ui"
          data-testid="new-pane-button"
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
      className="h-7 shrink-0 border-b border-border-subtle bg-elevated/40 px-3 flex items-center text-section-label text-text-3"
      data-testid="editor-tabs-slot"
      aria-hidden
    />
  );
}
