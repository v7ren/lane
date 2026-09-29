import type { OpenCodeRequestArgs } from './client.js';

export type OpenCodeTransport = (args: OpenCodeRequestArgs) => Promise<unknown>;

function encodeQueryComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function withDirectory(url: URL, directory: string): URL {
  const next = new URL(url.toString());
  next.searchParams.set('directory', directory);
  return next;
}

export function createFetchOpenCodeTransport(baseUrl: string, directory: string): OpenCodeTransport {
  const base = baseUrl.replace(/\/$/, '');
  return async (args: OpenCodeRequestArgs) => {
    const path = args.path.startsWith('/') ? args.path : `/${args.path}`;
    const url = withDirectory(new URL(`${base}${path}`), directory);
    if (args.query) {
      for (const [key, value] of Object.entries(args.query)) {
        url.searchParams.set(key, value);
      }
    }
    const init: RequestInit = { method: args.method };
    if (args.body !== undefined && args.method !== 'GET' && args.method !== 'HEAD') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(args.body);
    }
    const res = await fetch(url.toString(), init);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`OpenCode ${args.method} ${path}: HTTP ${res.status} ${text}`);
    }
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  };
}

/** Read raw SSE from GET /event and invoke callback for each JSON data line. */
export async function streamOpenCodeEvents(
  baseUrl: string,
  directory: string,
  onEvent: (payload: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const base = baseUrl.replace(/\/$/, '');
  const url = withDirectory(new URL(`${base}/event`), directory);
  const res = await fetch(url.toString(), { signal, headers: { Accept: 'text/event-stream' } });
  if (!res.ok || !res.body) {
    throw new Error(`OpenCode event stream: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const block of parts) {
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) {
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            onEvent(JSON.parse(data));
          } catch {
            /* skip malformed */
          }
        }
      }
    }
  }
}

export function directoryFromTransportArgs(_args: OpenCodeRequestArgs, fallback: string): string {
  return fallback;
}
