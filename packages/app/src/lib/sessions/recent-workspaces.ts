import { getSettingsLazyStore } from '../settings';

const RECENT_KEY = 'recent_workspaces';
const MAX = 12;

export async function loadRecentWorkspaces(): Promise<string[]> {
  try {
    const raw = await getSettingsLazyStore().get<string[]>(RECENT_KEY);
    return Array.isArray(raw) ? raw.filter(Boolean).slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export async function pushRecentWorkspace(path: string): Promise<string[]> {
  const trimmed = path.trim();
  if (!trimmed) return loadRecentWorkspaces();
  const next = [trimmed, ...(await loadRecentWorkspaces()).filter((p) => p !== trimmed)].slice(
    0,
    MAX,
  );
  await getSettingsLazyStore().set(RECENT_KEY, next);
  await getSettingsLazyStore().save();
  return next;
}
