#!/usr/bin/env node
/** Loomria strip: no bundled MCP/PWA/cloudflared resources. */
export function ensureTauriResources() {
  /* no-op */
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url.replace(/\\/g, '/').endsWith(process.argv[1].replace(/\\/g, '/'));

if (invokedDirectly) {
  ensureTauriResources();
}
