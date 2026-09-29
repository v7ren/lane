import { enqueueSettingsFileWrite, getSettingsLazyStore } from '../settings';

const RECENT_KEY = 'recent_workspaces';
const MAX = 12;

export async function loadRecentWorkspaces(): Promise<string[]> {
  try {
    return await enqueueSettingsFileWrite(async () => {
      const raw = await getSettingsLazyStore().get<string[]>(RECENT_KEY);
      return Array.isArray(raw) ? raw.filter(Boolean).slice(0, MAX) : [];
    });
  } catch {
    return [];
  }
}

export async function pushRecentWorkspace(path: string): Promise<string[]> {
  const trimmed = path.trim();
  if (!trimmed) return loadRecentWorkspaces();
  return enqueueSettingsFileWrite(async () => {
    const store = getSettingsLazyStore();
    const existing = await store.get<string[]>(RECENT_KEY);
    const list = Array.isArray(existing) ? existing.filter(Boolean) : [];
    const next = [trimmed, ...list.filter((p) => p !== trimmed)].slice(0, MAX);
    await store.set(RECENT_KEY, next);
    await store.save();
    return next;
  });
}
