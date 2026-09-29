import allowlist from '../../../src-tauri/opencode_allowlist.json';

export type AllowlistEntry = { method: string; template: string };

export const COMPOSER_ALLOWLIST_ROUTES: { method: string; path: string }[] = [
  { method: 'GET', path: '/find/file' },
  { method: 'GET', path: '/command' },
  { method: 'GET', path: '/agent' },
  { method: 'GET', path: '/provider' },
  { method: 'GET', path: '/config/providers' },
  { method: 'POST', path: '/session/{sessionID}/shell' },
  { method: 'POST', path: '/session/{sessionID}/command' },
  { method: 'POST', path: '/session/{sessionID}/abort' },
  { method: 'POST', path: '/session/{sessionID}/prompt_async' },
  { method: 'POST', path: '/permission/{requestID}/reply' },
  { method: 'POST', path: '/question/{requestID}/reply' },
  { method: 'POST', path: '/question/{requestID}/reject' },
];

function templateMatches(template: string, path: string): boolean {
  const tParts = template.split('/').filter(Boolean);
  const pParts = path.split('/').filter(Boolean);
  if (tParts.length !== pParts.length) return false;
  for (let i = 0; i < tParts.length; i += 1) {
    const t = tParts[i]!;
    const p = pParts[i]!;
    if (t.startsWith('{') && t.endsWith('}')) continue;
    if (t !== p) return false;
  }
  return true;
}

export function findMissingComposerAllowlistRoutes(
  entries: AllowlistEntry[] = allowlist as AllowlistEntry[],
): string[] {
  const missing: string[] = [];
  for (const route of COMPOSER_ALLOWLIST_ROUTES) {
    const ok = entries.some(
      (e) => e.method === route.method && templateMatches(e.template, route.path),
    );
    if (!ok) {
      missing.push(`${route.method} ${route.path}`);
    }
  }
  return missing;
}

export function composerAllowlistOk(): boolean {
  return findMissingComposerAllowlistRoutes().length === 0;
}
