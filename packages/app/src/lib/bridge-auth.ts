import { tauri } from './tauri';

let cached: { baseUrl: string; token: string } | null = null;

export async function loadBridgeSession(): Promise<{ baseUrl: string; token: string } | null> {
  if (cached?.token) return cached;
  const session = await tauri.getBridgeSession();
  if (!session.base_url || !session.token) return null;
  cached = { baseUrl: session.base_url, token: session.token };
  return cached;
}

export function bridgeAuthHeaders(): Record<string, string> {
  if (!cached?.token) return {};
  return { Authorization: `Bearer ${cached.token}` };
}

export function setBridgeSession(baseUrl: string, token: string): void {
  cached = { baseUrl, token };
}

export function eventsUrlWithToken(baseUrl: string): string {
  const token = cached?.token;
  if (!token) return `${baseUrl}/events`;
  return `${baseUrl}/events?token=${encodeURIComponent(token)}`;
}

export function isNgrokHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host.includes('ngrok');
  } catch {
    return false;
  }
}

export function ngrokRequestHeaders(_baseUrl: string): Record<string, string> {
  return {};
}

export function mergeBridgeHeaders(headers: Record<string, string>): Record<string, string> {
  return { ...headers };
}
