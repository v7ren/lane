#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const spec = path.join(root, 'packages/shared/src/opencode/openapi-1.18.18.json');
const out = path.join(root, 'packages/shared/src/opencode/schema.ts');

const bin = path.join(
  root,
  'node_modules',
  'openapi-typescript',
  'bin',
  'cli.js',
);

execFileSync(process.execPath, [bin, spec, '-o', out], { stdio: 'inherit', cwd: root });
