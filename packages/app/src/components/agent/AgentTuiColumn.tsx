import type { ReactNode } from 'react';

export function AgentTuiHeader({
  agentLabel,
  onHide,
}: {
  agentLabel: string;
  onHide: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-surface shrink-0 z-[2] relative"
      data-testid="agent-tui-header"
    >
      <span className="text-xs font-medium text-text truncate flex-1">{agentLabel}</span>
      <span className="text-[10px] uppercase tracking-wide text-text-3 shrink-0">Native TUI</span>
      <button
        type="button"
        className="px-2 py-1 text-xs rounded-md border border-border-subtle hover:bg-hover shrink-0"
        onClick={onHide}
      >
        Hide TUI
      </button>
    </div>
  );
}

export function AgentTuiPlaceholder() {
  return (
    <div className="absolute inset-0 z-[1] flex items-center justify-center p-6 text-center bg-lr-bg/90">
      <div className="max-w-xs space-y-2">
        <p className="text-sm font-medium text-lr-text">Terminal not connected</p>
        <p className="text-xs text-lr-muted">
          The native TUI appears here in the desktop app when this session has a live PTY. In demo
          or browser preview, launch from the desktop build to attach a terminal.
        </p>
      </div>
    </div>
  );
}

/** @deprecated Prefer AgentTuiHeader + PaneTerminalHost in AppShell agent column */
export function AgentTuiColumn({
  agentLabel,
  onHide,
  showPlaceholder,
  children,
}: {
  agentLabel: string;
  onHide: () => void;
  showPlaceholder: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col min-w-[280px] flex-1 min-h-0 border-l border-lr-border bg-lr-bg h-full">
      <AgentTuiHeader agentLabel={agentLabel} onHide={onHide} />
      <div className="relative flex-1 min-h-0">
        {showPlaceholder ? <AgentTuiPlaceholder /> : null}
        {children}
      </div>
    </div>
  );
}
