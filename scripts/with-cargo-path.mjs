#!/usr/bin/env node
/**
 * Run npm tauri with ~/.cargo/bin prepended to PATH.
 * Fixes "cargo metadata: program not found" when rustup didn't update the shell PATH.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickDevPort, PREFERRED_DEV_PORT } from './dev-port.mjs';
import { ensureWorkspaceBuilt } from './ensure-workspace-built.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cargoBin = join(homedir(), '.cargo', 'bin');
const cargoExe = join(cargoBin, process.platform === 'win32' ? 'cargo.exe' : 'cargo');
const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
const sep = process.platform === 'win32' ? ';' : ':';

const env = { ...process.env };

if (existsSync(cargoExe)) {
  const current = env[pathKey] ?? '';
  const parts = current.split(sep).filter(Boolean);
  const already = parts.some((p) => p.toLowerCase() === cargoBin.toLowerCase());
  if (!already) {
    env[pathKey] = `${cargoBin}${sep}${current}`;
  }
} else {
  console.error(
    `[with-cargo-path] cargo not found at ${cargoExe}\n` +
      'Install Rust from https://rustup.rs/ then reopen your terminal.',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (args[0] === 'dev') {
  ensureWorkspaceBuilt(repoRoot);
  const devPort = env.LOOMRIA_DEV_PORT ? Number(env.LOOMRIA_DEV_PORT) : await pickDevPort();
  env.LOOMRIA_DEV_PORT = String(devPort);
  // Tauri merges TAURI_CONFIG over tauri.conf.json, so the window loads the port Vite gets.
  let override = {};
  try {
    override = env.TAURI_CONFIG ? JSON.parse(env.TAURI_CONFIG) : {};
  } catch {
    override = {};
  }
  env.TAURI_CONFIG = JSON.stringify({
    ...override,
    build: { ...override.build, devUrl: `http://127.0.0.1:${devPort}` },
  });
  if (devPort !== PREFERRED_DEV_PORT) {
    console.error(`[loomria] port ${PREFERRED_DEV_PORT} is busy; using dev port ${devPort}`);
  }
  console.error('[loomria] starting dev stack (vite + tauri + embedded bridge)…');
}

const result = spawnSync(npm, ['run', 'tauri', '--workspace=@loomria/app', ...args], {
  stdio: 'inherit',
  env,
  cwd: repoRoot,
  shell: true,
});

const exitCode = result.status === null ? 1 : result.status;
process.exit(exitCode);
