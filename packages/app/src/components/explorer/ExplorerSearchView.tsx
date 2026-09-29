import { useMemo } from 'react';
import { useEditor } from '../../lib/editor/EditorContext';
import type { FindMatch } from '../../lib/editor/opencode-file-actions';

function groupByFile(rows: FindMatch[]): Map<string, FindMatch[]> {
  const map = new Map<string, FindMatch[]>();
  for (const row of rows) {
    const list = map.get(row.path) ?? [];
    list.push(row);
    map.set(row.path, list);
  }
  return map;
}

export function ExplorerSearchView() {
  const editor = useEditor();
  const grouped = useMemo(() => groupByFile(editor.searchResults), [editor.searchResults]);

  return (
    <div className="flex flex-col flex-1 min-h-0" data-testid="explorer-search-view">
      <div className="p-2 border-b border-border-subtle">
        <input
          autoFocus
          className="w-full h-8 px-2 rounded-md bg-canvas border border-border-subtle text-meta outline-none focus:border-accent"
          placeholder="Search in files…"
          value={editor.searchQuery}
          onChange={(e) => void editor.runSearch(e.target.value)}
        />
      </div>
      <ul className="flex-1 overflow-y-auto text-meta py-1">
        {[...grouped.entries()].map(([path, matches]) => (
          <li key={path} className="mb-2">
            <div className="px-3 py-1 text-text-2 truncate font-medium">{path}</div>
            <ul>
              {matches.map((row, i) => (
                <li key={`${row.line}:${i}`}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1 hover:bg-hover text-text-3 font-mono text-[11px]"
                    onClick={() => void editor.openFile(path, { preview: false, line: row.line })}
                  >
                    <span className="text-text-3 mr-2">{row.line}</span>
                    {row.text.trim() || '(match)'}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {editor.searchQuery && grouped.size === 0 && (
          <li className="px-3 py-2 text-text-3">No results</li>
        )}
      </ul>
    </div>
  );
}
