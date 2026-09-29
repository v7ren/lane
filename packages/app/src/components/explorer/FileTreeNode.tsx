import { ChevronRight, File, Folder } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { FsDirEntry } from '../../lib/editor/fs-client';
import { fsListDir } from '../../lib/editor/fs-client';

const ROW_H = 'h-7';

export function FileTreeNode({
  root,
  entry,
  depth,
  gitStatus,
  selectedPath,
  onSelect,
  onContextMenu,
}: {
  root: string;
  entry: FsDirEntry;
  depth: number;
  gitStatus?: string;
  selectedPath: string | null;
  onSelect: (path: string, preview: boolean) => void;
  onContextMenu: (path: string, x: number, y: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FsDirEntry[] | null>(null);
  const isDir = entry.kind === 'directory';

  const loadChildren = useCallback(async () => {
    const rows = await fsListDir(root, entry.path);
    setChildren(rows);
  }, [entry.path, root]);

  const toggle = async () => {
    if (!isDir) {
      onSelect(entry.path, true);
      return;
    }
    if (!open && !children) await loadChildren();
    setOpen((v) => !v);
  };

  const badge = gitStatus?.[0]?.toUpperCase();

  return (
    <>
      <button
        type="button"
        style={{ paddingLeft: 8 + depth * 12 }}
        className={`${ROW_H} w-full flex items-center gap-1 text-meta truncate hover:bg-hover ${
          selectedPath === entry.path ? 'bg-hover text-text' : 'text-text-2'
        }`}
        onClick={() => void toggle()}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(entry.path, e.clientX, e.clientY);
        }}
      >
        {isDir ? (
          <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-3" />
        )}
        {isDir ? <Folder size={14} className="shrink-0 text-text-3" /> : <File size={14} className="shrink-0 text-text-3" />}
        <span className="truncate">{entry.name}</span>
        {badge && (
          <span className="ml-auto pr-2 text-[10px] font-mono text-accent" data-testid={`git-badge-${entry.path}`}>
            {badge}
          </span>
        )}
      </button>
      {isDir && open && children?.map((child) => (
        <FileTreeNode
          key={child.path}
          root={root}
          entry={child}
          depth={depth + 1}
          gitStatus={gitStatus}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}
