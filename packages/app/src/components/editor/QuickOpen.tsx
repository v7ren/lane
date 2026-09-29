import { useEffect, useState } from 'react';
import { useEditor } from '../../lib/editor/EditorContext';

export function QuickOpen() {
  const editor = useEditor();
  const [query, setQuery] = useState('');
  const [paths, setPaths] = useState<string[]>([]);

  useEffect(() => {
    if (!editor.quickOpenOpen) return;
    let cancelled = false;
    void editor.fuzzyFiles(query).then((rows) => {
      if (!cancelled) setPaths(rows.slice(0, 40));
    });
    return () => {
      cancelled = true;
    };
  }, [editor, query]);

  if (!editor.quickOpenOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/50" data-testid="quick-open">
      <div className="w-full max-w-lg bg-surface border border-border-subtle rounded-lg shadow-lg overflow-hidden">
        <input
          autoFocus
          className="w-full h-10 px-3 bg-transparent border-b border-border-subtle text-body outline-none"
          placeholder="Search files by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') editor.closeQuickOpen();
          }}
        />
        <ul className="max-h-64 overflow-y-auto py-1">
          {paths.map((path) => (
            <li key={path}>
              <button
                type="button"
                className="w-full text-left px-3 h-7 text-meta hover:bg-hover truncate"
                onClick={() => {
                  void editor.openFile(path, { preview: true });
                  editor.closeQuickOpen();
                }}
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
