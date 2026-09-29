export function formatPaneSubtitle(
  paneId: string,
  agentLabel: string,
  cwd?: string | null,
): string {
  if (cwd?.trim()) {
    const base = cwd.trim().split(/[/\\]/).filter(Boolean).pop();
    if (base) return `${agentLabel} · ${base}`;
  }
  const short = paneId.replace(/^demo-/, '').slice(-8) || paneId.slice(0, 8);
  return `${agentLabel} · ${short}`;
}
