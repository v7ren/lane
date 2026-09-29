import { FileSearch, FolderPlus, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useEnvironment } from '../../lib/shell-data';
import { usePaneRegistry } from '../../hooks/usePaneRegistry';
import { fsCreate, fsDelete, fsListDir, type FsDirEntry } from '../../lib/editor/fs-client';
import { fileGitStatus } from '../../lib/editor/opencode-file-actions';
import { useEditor } from '../../lib/editor/EditorContext';
import { isTauriRuntime } from '../../lib/is-tauri';
import { FileTreeNode } from '../explorer/FileTreeNode';
import { ExplorerContextMenu } from '../explorer/ExplorerContextMenu';

export function ExplorerPanel() {
  const env = useEnvironment();
  const root = env.directory ?? '';
  const editor = useEditor();
  const registry = usePaneRegistry();
  const paneId = registry.paneList.find((p) => p.info.agent_type === 'opencode_native')?.info.id ?? null;

  const [entries, setEntries] = useState<FsDirEntry[]>([]);
  const [gitMap, setGitMap] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!root) return;
    setEntries(await fsListDir(root, ''));
    if (paneId || !isTauriRuntime()) {
      try {
        setGitMap(await fileGitStatus(paneId ?? 'demo'));
      } catch {
        setGitMap({});
      }
    }
  }, [paneId, root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const shot = new URLSearchParams(window.location.search).get('shot');
    if (shot === 'explorer-menu') {
      setMenu({ path: 'README', x: 220, y: 140 });
    }
  }, []);

  const baseName = (path: string) => path.split('/').pop() ?? path;

  return (
    <aside
      className="flex flex-col min-h-0 h-full bg-surface border-r border-border-subtle"
      data-testid="explorer-panel"
    >
      <div className="px-3 h-7 flex items-center justify-between border-b border-border-subtle">
        <span className="text-section-label text-text-3">Explorer</span>
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="Review" className="p-1 rounded hover:bg-hover text-text-3" onClick={() => editor.setMainView('review')}>
            <FileSearch size={14} strokeWidth={1.5} />
          </button>
          <button type="button" aria-label="Refresh" className="p-1 rounded hover:bg-hover text-text-3" onClick={() => void refresh()}>
            <RefreshCw size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label="New file"
            className="p-1 rounded hover:bg-hover text-text-3"
            onClick={() => {
              const name = window.prompt('New file name');
              if (!name || !root) return;
              const parent = selectedPath && selectedPath.includes('/') ? selectedPath.replace(/\/[^/]+$/, '') : selectedPath ?? '';
              const path = parent ? `${parent}/${name}` : name;
              void fsCreate(root, path, 'file').then(refresh);
            }}
          >
            <FolderPlus size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-1" role="tree">
        {!root ? (
          <p className="p-4 text-center text-meta text-text-3">Open a folder to browse files</p>
        ) : (
          entries.map((entry) => (
            <FileTreeNode
              key={entry.path}
              root={root}
              entry={entry}
              depth={0}
              gitStatus={gitMap[entry.path] ?? gitMap[baseName(entry.path)]}
              selectedPath={selectedPath}
              onSelect={(path, preview) => {
                setSelectedPath(path);
                void editor.openFile(path, { preview });
              }}
              onContextMenu={(path, x, y) => setMenu({ path, x, y })}
            />
          ))
        )}
      </div>
      {menu && root && (
        <ExplorerContextMenu
          path={menu.path}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onNewFile={() => {
            const name = window.prompt('New file name');
            if (!name) return;
            const dir = menu.path.includes('.') ? menu.path.replace(/\/[^/]+$/, '') : menu.path;
            void fsCreate(root, dir ? `${dir}/${name}` : name, 'file').then(refresh);
          }}
          onNewFolder={() => {
            const name = window.prompt('New folder name');
            if (!name) return;
            const dir = menu.path.includes('.') ? menu.path.replace(/\/[^/]+$/, '') : menu.path;
            void fsCreate(root, dir ? `${dir}/${name}` : name, 'directory').then(refresh);
          }}
          onRename={() => {
            const name = window.prompt('Rename to', baseName(menu.path));
            if (!name) return;
            const dir = menu.path.replace(/\/[^/]+$/, '');
            const to = dir ? `${dir}/${name}` : name;
            void import('../../lib/editor/fs-client').then(({ fsRename }) => fsRename(root, menu.path, to).then(refresh));
          }}
          onDelete={() => {
            if (window.confirm(`Delete ${menu.path}?`)) void fsDelete(root, menu.path).then(refresh);
          }}
          onReveal={() => {
            /* Reveal uses shell integration when running in Tauri. */
          }}
          onCopyPath={() => void navigator.clipboard.writeText(menu.path)}
        />
      )}
    </aside>
  );
}
