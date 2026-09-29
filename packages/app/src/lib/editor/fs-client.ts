import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../is-tauri';
import { getDemoFs } from '../demo/editor-fixtures';

export type FsReadResult = {
  content: string;
  encoding: string;
  size: number;
  mtimeMs: number;
};

export type FsDirEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory' | string;
};

const demo = () => getDemoFs();

export async function fsListDir(root: string, path: string): Promise<FsDirEntry[]> {
  if (!isTauriRuntime()) return demo().listDir(path);
  return invoke<FsDirEntry[]>('fs_list_dir', { root, path });
}

export async function fsReadFile(root: string, path: string): Promise<FsReadResult> {
  if (!isTauriRuntime()) return demo().readFile(path);
  return invoke<FsReadResult>('fs_read_file', { root, path });
}

export async function fsWriteFile(
  root: string,
  path: string,
  content: string,
  expectedMtimeMs?: number | null,
): Promise<{ mtimeMs: number; size: number }> {
  if (!isTauriRuntime()) return demo().writeFile(path, content, expectedMtimeMs);
  return invoke('fs_write_file', {
    args: { root, path, content, expectedMtimeMs: expectedMtimeMs ?? null },
  });
}

export async function fsWalkFiles(root: string, query: string): Promise<string[]> {
  if (!isTauriRuntime()) return demo().walkFiles(query);
  return invoke<string[]>('fs_walk_files', { root, query });
}

export async function fsCreate(
  root: string,
  path: string,
  kind: 'file' | 'directory',
): Promise<void> {
  if (!isTauriRuntime()) {
    demo().create(path, kind);
    return;
  }
  await invoke('fs_create', { args: { root, path, kind } });
}

export async function fsRename(root: string, from: string, to: string): Promise<void> {
  if (!isTauriRuntime()) {
    demo().rename(from, to);
    return;
  }
  await invoke('fs_rename', { root, from, to });
}

export async function fsDelete(root: string, path: string): Promise<void> {
  if (!isTauriRuntime()) {
    demo().delete(path);
    return;
  }
  await invoke('fs_delete', { root, path });
}

export async function fsStartWatcher(root: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke('fs_start_watcher', { root });
}
