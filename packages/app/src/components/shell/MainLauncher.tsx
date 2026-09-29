export function MainLauncher() {
  const shortcuts = [
    { label: 'New agent', keys: ['Ctrl', 'Shift', 'L'] },
    { label: 'Toggle panel', keys: ['Ctrl', 'J'] },
    { label: 'Search files', keys: ['Ctrl', 'P'] },
    { label: 'Command palette', keys: ['Ctrl', 'K'] },
  ];

  return (
    <div
      className="flex-1 min-h-0 flex flex-col items-center justify-center gap-6 p-8 bg-canvas"
      data-testid="main-launcher"
    >
      <div
        className="w-14 h-14 rounded-lg bg-elevated border border-border-subtle flex items-center justify-center"
        aria-hidden
      >
        <span className="text-xl font-semibold text-accent">L</span>
      </div>
      <p className="text-body text-text-2">Start working in this repository.</p>
      <ul className="space-y-2 w-full max-w-sm">
        {shortcuts.map((row) => (
          <li
            key={row.label}
            className="flex items-center justify-between gap-4 text-meta text-text-2"
          >
            <span>{row.label}</span>
            <span className="flex items-center gap-1">
              {row.keys.map((k) => (
                <kbd
                  key={k}
                  className="min-w-[1.5rem] text-center px-1.5 py-0.5 rounded border border-border bg-elevated text-text-3 text-[11px] font-mono"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
