/** Unescape JSON-style Windows path strings for display. */
export function unescapeDisplayPath(raw: string): string {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.replace(/\\\\/g, '\\');
}

export function normalizePathForDisplay(path: string, projectRoot?: string | null): string {
  const unescaped = unescapeDisplayPath(path);
  if (!projectRoot) {
    return unescaped.replace(/\\/g, '/');
  }
  const normRoot = projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
  const normPath = unescaped.replace(/\\/g, '/');
  const rootLower = normRoot.toLowerCase();
  const pathLower = normPath.toLowerCase();
  if (pathLower.startsWith(`${rootLower}/`)) {
    return normPath.slice(normRoot.length + 1);
  }
  if (pathLower === rootLower) {
    return normPath.split('/').pop() ?? unescaped;
  }
  return unescaped;
}

export function normalizeToolPathValue(value: unknown, projectRoot?: string | null): unknown {
  if (typeof value === 'string') {
    return normalizePathForDisplay(value, projectRoot);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeToolPathValue(entry, projectRoot));
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const next: Record<string, unknown> = { ...rec };
    for (const key of ['path', 'filePath', 'file', 'target', 'filename'] as const) {
      if (typeof rec[key] === 'string') {
        next[key] = normalizePathForDisplay(rec[key] as string, projectRoot);
      }
    }
    return next;
  }
  return value;
}
