import { X } from 'lucide-react';
import type { EditorTab } from '../../lib/editor/tabs';

export function EditorTabsBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onDoubleClick,
}: {
  tabs: EditorTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onDoubleClick: (id: string) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div
      className="h-7 shrink-0 border-b border-border-subtle bg-elevated/40 flex items-stretch overflow-x-auto"
      data-testid="editor-tabs"
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => onDoubleClick(tab.id)}
            className={`group flex items-center gap-1.5 px-3 max-w-[14rem] border-r border-border-subtle text-meta shrink-0 ${
              active ? 'bg-surface text-text' : 'text-text-3 hover:text-text-2 hover:bg-hover'
            } ${tab.preview && !tab.pinned ? 'italic' : ''}`}
          >
            <span className="truncate">{tab.label}</span>
            {tab.dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-label="unsaved" />}
            <span
              role="button"
              tabIndex={-1}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-hover"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <X size={12} strokeWidth={1.5} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
