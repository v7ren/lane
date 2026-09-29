import { LazyStore } from '@tauri-apps/plugin-store';

const STORE_FILENAME = 'loomria-session-notify.json';
const KEY = 'muted_pane_ids';

let store: LazyStore | null = null;

function getStore(): LazyStore {
  if (!store) {
    store = new LazyStore(STORE_FILENAME, { defaults: {}, autoSave: true });
  }
  return store;
}

export async function loadMutedSessionIds(): Promise<Set<string>> {
  const raw = await getStore().get<string[]>(KEY);
  return new Set(raw ?? []);
}

export async function isSessionMuted(paneId: string): Promise<boolean> {
  const muted = await loadMutedSessionIds();
  return muted.has(paneId);
}

export async function setSessionMuted(paneId: string, muted: boolean): Promise<void> {
  const ids = await loadMutedSessionIds();
  if (muted) ids.add(paneId);
  else ids.delete(paneId);
  await getStore().set(KEY, [...ids]);
}
