import type { ShellSession } from '../shell-data';

export type WorkspaceGroup = {
  key: string;
  label: string;
  tooltip: string;
  rows: ShellSession[];
};

export function pathBasename(dir: string): string {
  const parts = dir.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

export function pathParentBasename(dir: string): string | null {
  const parts = dir.split(/[/\\]/).filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 2] ?? null;
}

export function groupSessionsByWorkspace(sessions: ShellSession[]): WorkspaceGroup[] {
  const byDir = new Map<string, ShellSession[]>();
  for (const row of sessions) {
    const dir = row.workspaceDirectory ?? row.workspaceLabel ?? 'Workspace';
    const list = byDir.get(dir) ?? [];
    list.push(row);
    byDir.set(dir, list);
  }

  const dirs = [...byDir.keys()];
  const basenameCounts = new Map<string, number>();
  for (const dir of dirs) {
    const base = pathBasename(dir);
    basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1);
  }

  return dirs.map((dir) => {
    const base = pathBasename(dir);
    const duplicate = (basenameCounts.get(base) ?? 0) > 1;
    const parent = pathParentBasename(dir);
    const label = duplicate && parent ? `${parent}/${base}` : base;
    return {
      key: dir,
      label,
      tooltip: dir,
      rows: byDir.get(dir) ?? [],
    };
  });
}
