import { dispatchAddToComposer } from '../../lib/editor/add-to-composer';

export function ExplorerContextMenu({
  path,
  x,
  y,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onReveal,
  onCopyPath,
}: {
  path: string;
  x: number;
  y: number;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onReveal: () => void;
  onCopyPath: () => void;
}) {
  const items = [
    { label: 'New file', run: onNewFile },
    { label: 'New folder', run: onNewFolder },
    { label: 'Rename', run: onRename },
    { label: 'Delete', run: onDelete },
    { label: 'Reveal in explorer', run: onReveal },
    { label: 'Copy path', run: onCopyPath },
    {
      label: 'Add to chat',
      run: () => {
        dispatchAddToComposer({ path });
        onClose();
      },
    },
  ];

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <ul
        className="fixed z-[51] min-w-[10rem] py-1 rounded-md border border-border-subtle bg-elevated shadow-lg text-meta"
        style={{ left: x, top: y }}
        data-testid="explorer-context-menu"
      >
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              className="w-full text-left px-3 h-7 hover:bg-hover text-text-2"
              onClick={() => {
                item.run();
                onClose();
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
