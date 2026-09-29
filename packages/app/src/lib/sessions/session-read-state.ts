const READ_KEY = 'loomria-session-read';

function load(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(READ_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function save(map: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(READ_KEY, JSON.stringify(map));
}

export function sessionReadKey(paneId: string, sessionId: string): string {
  return `${paneId}:${sessionId}`;
}

export function getSessionReadMap(): Record<string, number> {
  return load();
}

export function markSessionRead(paneId: string, sessionId: string): void {
  const map = load();
  map[sessionReadKey(paneId, sessionId)] = Date.now();
  save(map);
}
