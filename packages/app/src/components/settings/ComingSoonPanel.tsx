export function ComingSoonPanel({ title }: { title: string }) {
  return (
    <div data-testid="settings-coming-soon">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 rounded-xl border border-dashed border-pm-border bg-pm-panel p-6 text-sm text-pm-muted">
        <span className="font-medium text-pm-text">Coming soon.</span> {title} settings are not
        available yet; nothing here can be changed.
      </div>
    </div>
  );
}
