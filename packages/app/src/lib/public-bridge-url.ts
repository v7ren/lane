const DEFAULT_DEV_SERVER_PORT = 1420;

export function parseDevServerPort(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return DEFAULT_DEV_SERVER_PORT;
  return n;
}

/** Legacy localStorage key from mobile PWA pairing — ignored in Loomria strip. */
export function readStoredPublicBridgeUrl(): string | null {
  return null;
}

export function publicOriginFromBridgeUrl(bridgeUrl: string): string | undefined {
  try {
    const url = new URL(bridgeUrl);
    return url.origin;
  } catch {
    return undefined;
  }
}

export { DEFAULT_DEV_SERVER_PORT };
