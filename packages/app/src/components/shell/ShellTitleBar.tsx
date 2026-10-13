import { PanelRight, Plus } from 'lucide-react';
import type { RefObject } from 'react';

const UI_MODE_SEGMENTS: { id: 'agent' | 'ide'; label: string }[] = [
  { id: 'agent', label: 'Agent' },
  { id: 'ide', label: 'IDE' },
];

function UiModeSwitch({
  uiMode,
  onChange,
}: {
  uiMode: 'agent' | 'ide';
  onChange: (mode: 'agent' | 'ide') => void;
}) {
  return (
    <div
      role="group"
      aria-label="Interface mode"
      data-testid="ui-mode-switch"
      className="inline-flex items-center rounded-md border border-border-subtle bg-elevated/40 p-0.5"
    >
      {UI_MODE_SEGMENTS.map((seg) => {
        const active = uiMode === seg.id;
        return (
          <button
            key={seg.id}
            type="button"
            aria-pressed={active}
            data-testid={`ui-mode-${seg.id}`}
            onClick={() => {
              if (!active) onChange(seg.id);
            }}
            className={[
              'rounded px-2 py-0.5 text-meta transition-colors duration-ui',
              active ? 'bg-hover text-text' : 'text-text-3 hover:text-text',
            ].join(' ')}
          >
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}

export function ShellTitleBar({
  newPaneButtonRef,
  onNewPane,
  showRightRailToggle,
  onToggleRightRail,
  uiMode,
  onUiModeChange,
}: {
  newPaneButtonRef?: RefObject<HTMLButtonElement>;
  onNewPane: () => void;
  showRightRailToggle?: boolean;
  onToggleRightRail?: () => void;
  /** Renders the Agent / IDE switch when both are provided. */
  uiMode?: 'agent' | 'ide';
  onUiModeChange?: (mode: 'agent' | 'ide') => void;
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
      <div className="flex-1 flex justify-end items-center gap-2">
        {uiMode && onUiModeChange && <UiModeSwitch uiMode={uiMode} onChange={onUiModeChange} />}
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
