/**
 * Escape text for non-React sinks (attributes, HTML strings). Do not use on strings rendered
 * as React children — React already escapes text nodes.
 */

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeAgentText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE[ch] ?? ch);
}

export function isSafeHttpUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
