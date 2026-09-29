import { homeDir } from '@tauri-apps/api/path';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { isTauriRuntime } from './is-tauri';

/** Paths that must not be used as a project root (macOS DMG apps often default cwd to `/`). */
export function isValidProjectPath(path: string | null | undefined): path is string {
  if (!path?.trim()) return false;
  const normalized = path.trim().replace(/\\/g, '/');
  return normalized !== '/' && !/^[A-Za-z]:$/.test(normalized);
}

/** Compare project paths after normalizing separators. */
export function projectPathsEqual(a: string, b: string): boolean {
  return a.trim().replace(/\\/g, '/') === b.trim().replace(/\\/g, '/');
}

export async function pickProjectFolder(projectPath: string | null): Promise<string | null> {
  if (!isTauriRuntime()) {
    return projectPath ?? 'C:\\Users\\demo\\loomria';
  }
  const result = await openDialog({
    directory: true,
    multiple: false,
    defaultPath: (await homeDir()) ?? projectPath ?? undefined,
  });
  return typeof result === 'string' ? result : null;
}
