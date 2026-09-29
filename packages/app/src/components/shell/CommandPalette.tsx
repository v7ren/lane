import { useEffect, useMemo, useRef, useState } from 'react';
import {
  filterPaletteCommands,
  type PaletteCommand,
} from '../../lib/commands/index';
export type { PaletteCommand } from '../../lib/commands/index';
export { filterPaletteCommands } from '../../lib/commands/index';

export function CommandPalette({
  open,
  fileMode,
  onClose,
  commands,
}: {
  open: boolean;
  fileMode: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, fileMode]);

  const filtered = useMemo(() => {
    const base = fileMode
      ? commands.filter((c) => c.section === 'Files' || c.id.startsWith('file-'))
      : commands;
    return filterPaletteCommands(base, query);
  }, [commands, fileMode, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] bg-canvas/70 backdrop-blur-[2px]"
      data-testid="command-palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-elevated shadow-2xl overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={fileMode ? 'Search files…' : 'Type a command…'}
          className="w-full px-3 py-2.5 text-body bg-transparent border-b border-border-subtle outline-none text-text placeholder:text-text-3"
          data-testid="command-palette-input"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-meta text-text-3">No matches</li>
          )}
          {filtered.map((cmd) => (
            <li key={cmd.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-hover transition-colors duration-ui flex items-center justify-between gap-2"
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
              >
                <span className="text-body text-text">{cmd.label}</span>
                <span className="text-meta text-text-3 uppercase tracking-wide">{cmd.section}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export { buildPaletteCommands } from '../../lib/commands/sessions';
