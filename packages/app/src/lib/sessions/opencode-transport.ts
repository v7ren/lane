import type { OpenCodeRequestArgs } from './opencode-session-actions';

export type OpenCodeTransport = <T = unknown>(args: OpenCodeRequestArgs) => Promise<T>;

let transport: OpenCodeTransport | null = null;

export function setOpenCodeTransport(next: OpenCodeTransport | null): void {
  transport = next;
}

export function getOpenCodeTransport(): OpenCodeTransport | null {
  return transport;
}

/** Direct HTTP transport for live tests against `opencode serve`. */
export function createFetchOpenCodeTransport(baseUrl: string, directory: string): OpenCodeTransport {
  const base = baseUrl.replace(/\/$/, '');
  return async function fetchTransport<T>(args: OpenCodeRequestArgs): Promise<T> {
    let url = `${base}${args.path.startsWith('/') ? args.path : `/${args.path}`}`;
    const params = new URLSearchParams();
    params.set('directory', directory);
    if (args.query) {
      for (const [key, value] of Object.entries(args.query)) {
        if (key !== 'directory') params.set(key, value);
      }
    }
    url = `${url}?${params.toString()}`;
    const init: RequestInit = {
      method: args.method.toUpperCase(),
      headers: args.body ? { 'Content-Type': 'application/json' } : undefined,
      body: args.body ? JSON.stringify(args.body) : undefined,
    };
    const res = await fetch(url, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenCode ${args.method} ${args.path} failed: ${res.status} ${text}`);
    }
    if (res.status === 204) return null as T;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      return (await res.json()) as T;
    }
    return (await res.text()) as T;
  };
}
