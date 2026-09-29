#!/usr/bin/env node
/**
 * Generate OpenCode HTTP proxy allowlist from the pinned OpenAPI spec (legacy routes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const specPath = path.join(
  root,
  'packages/shared/src/opencode/openapi-1.18.18.json',
);
const outPath = path.join(root, 'packages/app/src-tauri/opencode_allowlist.json');

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

const EXCLUDED_PREFIXES = [
  '/api/',
  '/experimental/',
  '/log',
  '/instance/',
  '/global/event',
  '/global/dispose',
  '/global/upgrade',
  '/global/config',
];

const EXCLUDED_EXACT = new Set(['/event']);

/** @type {{ method: string, template: string }[]} */
const entries = [];

for (const [route, methods] of Object.entries(spec.paths ?? {})) {
  if (EXCLUDED_EXACT.has(route)) {
    continue;
  }
  if (EXCLUDED_PREFIXES.some((prefix) => route.startsWith(prefix))) {
    continue;
  }
  for (const method of Object.keys(methods)) {
    const lower = method.toLowerCase();
    if (!['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(lower)) {
      continue;
    }
    entries.push({ method: lower.toUpperCase(), template: route });
  }
}

entries.sort((a, b) => a.template.localeCompare(b.template) || a.method.localeCompare(b.method));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
console.log(`Wrote ${entries.length} allowlist entries to ${path.relative(root, outPath)}`);
