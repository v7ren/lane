import { LazyStore } from '@tauri-apps/plugin-store';
import { SETTINGS_STORE_FILENAME } from '../settings';

const RECENT_KEY = 'recent_workspaces';
const MAX = 12;

let cached: LazyStore | null = null;

function store(): LazyStore {
  if (!cached) {
    cached = new LazyStore(SETTINGS_STORE_FILENAME, { defaults: {}, autoSave: true });
  }
  return cached;
}

export async function loadRecentWorkspaces(): Promise<string[]> {
  try {
    const raw = await store().get<string[]>(RECENT_KEY);
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
  await store().set(RECENT_KEY, next);
  await store().save();
  return next;
}
