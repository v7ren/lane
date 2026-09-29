import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';

const PNG = pngjs.PNG;

const root = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');
const appDir = path.join(root, 'packages', 'app');
const port = process.env.VITE_PORT ?? '1421';

const shots = [
  {
    file: 'explorer-tree.png',
    url: `http://127.0.0.1:${port}/?demo`,
    wait: '[data-testid="explorer-context-menu"]',
    setup: async (page) => {
      const readme = page.locator('[data-testid="explorer-panel"] button', { hasText: 'README' });
      await readme.click({ button: 'right' });
    },
  },
  {
    file: 'editor-tabs.png',
    url: `http://127.0.0.1:${port}/?demo&shot=editor-tabs`,
    wait: '[data-testid="editor-tabs"] .bg-accent',
  },
  {
    file: 'quick-open.png',
    url: `http://127.0.0.1:${port}/?demo&shot=quick-open`,
    wait: '[data-testid="quick-open"] input',
  },
  {
    file: 'search-panel.png',
    url: `http://127.0.0.1:${port}/?demo&shot=search`,
    wait: '[data-testid="explorer-search-view"]',
  },
  {
    file: 'review-diff.png',
    url: `http://127.0.0.1:${port}/?demo&shot=review`,
    wait: '[data-testid="monaco-diff-editor"] .view-lines',
  },
  {
    file: 'conflict-banner.png',
    url: `http://127.0.0.1:${port}/?demo&shot=conflict-banner`,
    wait: '[data-testid="conflict-banner"]',
    alsoWait: '[data-testid="monaco-editor-pane"] .view-lines',
  },
];

async function isUniformPng(filePath) {
  const buf = await readFile(filePath);
  const png = PNG.sync.read(buf);
  const first = png.data[0];
  const second = png.data[1];
  const third = png.data[2];
  let uniform = true;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i] !== first || png.data[i + 1] !== second || png.data[i + 2] !== third) {
      uniform = false;
      break;
    }
  }
  return uniform;
}

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', port], {
  cwd: appDir,
  shell: true,
  stdio: 'pipe',
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite start timeout')), 60_000);
  const onData = (buf) => {
    if (String(buf).includes(port)) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on('data', onData);
  server.stderr.on('data', onData);
});

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const shot of shots) {
  await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30_000 });
  if (shot.setup) await shot.setup(page);
  await page.waitForSelector(shot.wait, { timeout: 30_000 });
  if (shot.alsoWait) await page.waitForSelector(shot.alsoWait, { timeout: 30_000 });
  const outPath = path.join(outDir, shot.file);
  await page.screenshot({ path: outPath, fullPage: false });
  if (await isUniformPng(outPath)) {
    throw new Error(`${shot.file} appears blank (uniform pixels)`);
  }
  console.log('OK', shot.file);
}

await browser.close();
server.kill();
console.log('Saved screenshots to', outDir);
