export function AgentPanelEmpty({ onStartAgent }: { onStartAgent: () => void }) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
      data-testid="agent-panel-empty"
    >
      <p className="text-body text-text-2 max-w-sm">
        No agent running. Start one with{' '}
        <kbd className="px-1.5 py-0.5 rounded border border-border bg-elevated text-meta font-mono">
          Ctrl+Shift+L
        </kbd>
      </p>
      <button
        type="button"
        onClick={onStartAgent}
        className="px-3 py-1.5 rounded-md border border-border bg-elevated text-body text-text hover:bg-hover transition-colors duration-ui"
      >
        New agent
      </button>
    </div>
  );
}
