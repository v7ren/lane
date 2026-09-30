/** In-flow mount point for a pane's persistent xterm wrapper (reparented by TerminalLifecycle). */
export function PaneTerminalHost({
  paneId,
  className = '',
}: {
  paneId: string;
  className?: string;
}) {
  return (
    <div
      data-terminal-host={paneId}
      className={`relative flex-1 min-h-0 min-w-0 ${className}`}
    />
  );
}
