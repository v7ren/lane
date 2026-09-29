import { useEditor } from '../../lib/editor/EditorContext';

export function SearchPanel() {
  const editor = useEditor();
  if (!editor.searchOpen) return null;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-80 z-40 bg-surface border-l border-border-subtle flex flex-col"
      data-testid="search-panel"
    >
      <div className="h-7 flex items-center px-3 border-b border-border-subtle text-section-label text-text-3">
        Search
        <button type="button" className="ml-auto text-text-3 hover:text-text" onClick={editor.closeSearch}>
          ×
        </button>
      </div>
      <div className="p-2 border-b border-border-subtle">
        <input
          className="w-full h-8 px-2 rounded-md bg-canvas border border-border-subtle text-meta outline-none focus:border-accent"
          placeholder="Search in files…"
          value={editor.searchQuery}
          onChange={(e) => void editor.runSearch(e.target.value)}
        />
      </div>
      <ul className="flex-1 overflow-y-auto text-meta">
        {editor.searchResults.map((row, i) => (
          <li key={`${row.path}:${row.line}:${i}`}>
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-hover border-b border-border-subtle/50"
              onClick={() => void editor.openFile(row.path)}
            >
              <div className="text-text-2 truncate">{row.path}:{row.line}</div>
              <div className="text-text-3 truncate font-mono text-[11px]">{row.text}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
