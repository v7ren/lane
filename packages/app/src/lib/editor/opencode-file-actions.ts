import { invoke } from '@tauri-apps/api/core';
import type { components } from '@loomria/shared/opencode';
import { isTauriRuntime } from '../is-tauri';
import { getDemoFs } from '../demo/editor-fixtures';

type FileNode = components['schemas']['FileNode'];

async function request<T>(paneId: string, method: string, path: string, query?: Record<string, string>): Promise<T> {
  return invoke<T>('opencode_request', {
    args: { pane_id: paneId, method, path, query },
  });
}

export async function listProjectFiles(paneId: string, path?: string): Promise<FileNode[]> {
  return request<FileNode[]>(paneId, 'GET', '/file', path ? { path } : undefined);
}

export async function findFiles(paneId: string, query: string): Promise<string[]> {
  const rows = await request<{ path: string }[]>(paneId, 'GET', '/find/file', { query });
  return rows.map((r) => r.path);
}

export type FindMatch = { path: string; line: number; text: string };

export async function findInFiles(paneId: string, query: string): Promise<FindMatch[]> {
  const rows = await request<{ path: string; matches: { line: number; text: string }[] }[]>(
    paneId,
    'GET',
    '/find',
    { query },
  );
  const out: FindMatch[] = [];
  for (const file of rows) {
    for (const m of file.matches ?? []) {
      out.push({ path: file.path, line: m.line, text: m.text });
    }
  }
  return out;
}

export async function fileGitStatus(paneId: string): Promise<Record<string, string>> {
  if (!isTauriRuntime()) return getDemoFs().fileStatus();
  const rows = await request<{ path: string; status: string }[]>(paneId, 'GET', '/file/status');
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.path] = row.status;
  }
  return map;
}

export type DiffFile = { path: string; before: string; after: string };

export async function vcsWorkingDiff(paneId: string): Promise<DiffFile[]> {
  if (!isTauriRuntime()) {
    const demo = getDemoFs();
    return demo.vcsDiff().map((d) => ({
      path: d.path,
      before: demo.readFile(d.path).content.replace('hello', 'hi'),
      after: demo.readFile(d.path).content,
    }));
  }
  return request<DiffFile[]>(paneId, 'GET', '/vcs/diff');
}

export async function sessionDiff(paneId: string, sessionId: string): Promise<DiffFile[]> {
  return request<DiffFile[]>(paneId, 'GET', `/session/${sessionId}/diff`);
}
