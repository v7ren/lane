import { opencodeClient, type OpenCodeRequestArgs } from '../opencode/client.js';
import { invoke } from '@tauri-apps/api/core';

async function request<T = unknown>(args: OpenCodeRequestArgs): Promise<T> {
  return invoke<T>('opencode_request', { args });
}

export async function findProjectFiles(paneId: string, query: string, limit = 20) {
  return request<{ path: string; name?: string }[]>({
    pane_id: paneId,
    method: 'GET',
    path: '/find/file',
    query: { query, limit: String(limit) },
  });
}

export async function findProjectText(paneId: string, query: string, limit = 20) {
  return request<unknown[]>({
    pane_id: paneId,
    method: 'GET',
    path: '/find',
    query: { query, limit: String(limit) },
  });
}

export { opencodeClient };
