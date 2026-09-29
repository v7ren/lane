#!/usr/bin/env node
/**
 * Tauri beforeDevCommand entry: build workspace deps and start Vite.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureWorkspaceBuilt } from './ensure-workspace-built.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(repoRoot, 'packages', 'app');
const portFiles = [
  join(repoRoot, 'loomria.bridge.port'),
  join(repoRoot, 'puppet-master.bridge.port'),
];
const VITE_PORT = 1420;
const VITE_URL = `http://127.0.0.1:${VITE_PORT}`;

ensureWorkspaceBuilt(repoRoot);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const vite = spawn(npm, ['exec', 'vite'], {
  cwd: appDir,
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

function shutdown(signal) {
  vite.kill(signal);
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    shutdown(signal);
  });
}

vite.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

void waitForVite().then(() => {
  const bridge = readBridgeUrl();
  console.error('');
  console.error('[loomria] dev stack ready');
  console.error(`  vite / PWA:     ${VITE_URL}`);
  console.error(`  bridge proxy:   ${VITE_URL}/bridge  (→ desktop bridge when app is up)`);
  if (bridge) console.error(`  bridge direct:  ${bridge}`);
  else console.error('  bridge direct:  starts with the Tauri window (embedded HTTP bridge)');
  console.error('');
});

async function waitForVite(maxMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${VITE_URL}/`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

function readBridgeUrl() {
  try {
    const portFile = portFiles.find((path) => existsSync(path));
    if (!portFile) return null;
    const raw = readFileSync(portFile, 'utf-8').trim();
    if (!raw) return null;
    if (raw.includes(':')) {
      const [host, port] = raw.split(':');
      return `http://${host || '127.0.0.1'}:${port}`;
    }
    return `http://127.0.0.1:${raw}`;
  } catch {
    return null;
  }
}
