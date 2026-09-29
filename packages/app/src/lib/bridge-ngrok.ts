export function isNgrokHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host.includes('ngrok');
  } catch {
    return false;
  }
}

/** ngrok free tier may require skip-browser-warning; unused in desktop-only strip. */
export function ngrokRequestHeaders(_baseUrl: string): Record<string, string> {
  return {};
}
