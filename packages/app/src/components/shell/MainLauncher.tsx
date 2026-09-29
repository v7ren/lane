import { useRef } from 'react';
import { LoomMark } from './LoomMark';

type ShortcutRow = {
  label: string;
  keys: string[];
  onClick: (anchor: HTMLElement | null) => void;
};

export function MainLauncher({
  onNewAgent,
  onTogglePanel,
  onSearchFiles,
  onCommandPalette,
}: {
  onNewAgent: (anchor: HTMLElement | null) => void;
  onTogglePanel: () => void;
  onSearchFiles: () => void;
  onCommandPalette: () => void;
}) {
  const newAgentRef = useRef<HTMLButtonElement>(null);
  const shortcuts: ShortcutRow[] = [
    {
      label: 'New agent',
      keys: ['Ctrl', 'Shift', 'L'],
      onClick: (anchor) => onNewAgent(anchor),
    },
    { label: 'Toggle panel', keys: ['Ctrl', 'J'], onClick: () => onTogglePanel() },
    { label: 'Search files', keys: ['Ctrl', 'P'], onClick: () => onSearchFiles() },
    { label: 'Command palette', keys: ['Ctrl', 'K'], onClick: () => onCommandPalette() },
  ];

  return (
    <div
      className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 p-8 bg-canvas"
      data-testid="main-launcher"
    >
      <LoomMark className="w-11 h-11 text-text-3 opacity-80" />
      <p className="text-body text-text-2">Start working in this repository.</p>
      <ul className="space-y-1 w-full max-w-sm">
        {shortcuts.map((row) => (
          <li key={row.label}>
            <button
              ref={row.label === 'New agent' ? newAgentRef : undefined}
              type="button"
              onClick={() =>
                row.onClick(row.label === 'New agent' ? newAgentRef.current : null)
              }
              className="w-full h-7 flex items-center justify-between gap-4 px-2 rounded-md text-meta text-text-2 hover:bg-hover transition-colors duration-ui"
            >
              <span>{row.label}</span>
              <span className="flex items-center gap-1 shrink-0">
                {row.keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-[1.5rem] text-center px-1.5 py-0.5 rounded border border-border-subtle bg-elevated text-text-3 text-[11px] font-mono"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
