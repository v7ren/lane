export function ExplorerPanel() {
  return (
    <aside
      className="flex flex-col min-h-0 h-full bg-surface border-r border-border-subtle"
      data-testid="explorer-panel"
    >
      <div className="px-3 py-2 border-b border-border-subtle">
        <span className="text-section-label text-text-3">Explorer</span>
      </div>
      <div className="flex-1 flex items-center justify-center p-4 text-center">
        <p className="text-meta text-text-3 max-w-[12rem]">Open a folder to browse files</p>
      </div>
    </aside>
  );
}
