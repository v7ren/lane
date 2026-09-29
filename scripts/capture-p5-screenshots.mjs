import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');
const appDir = path.join(root, 'packages', 'app');

const shots = [
  { file: 'explorer-tree.png', url: 'http://127.0.0.1:1420/?demo&shot=explorer-menu' },
  { file: 'editor-tabs.png', url: 'http://127.0.0.1:1420/?demo&shot=editor-tabs' },
  { file: 'quick-open.png', url: 'http://127.0.0.1:1420/?demo&shot=quick-open' },
  { file: 'search-panel.png', url: 'http://127.0.0.1:1420/?demo&shot=search' },
  { file: 'review-diff.png', url: 'http://127.0.0.1:1420/?demo&shot=review' },
  { file: 'conflict-banner.png', url: 'http://127.0.0.1:1420/?demo&shot=conflict-banner' },
];

const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '1420'], {
  cwd: appDir,
  shell: true,
  stdio: 'pipe',
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('vite start timeout')), 60_000);
  server.stdout.on('data', (buf) => {
    if (String(buf).includes('1420')) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.stderr.on('data', (buf) => {
    if (String(buf).includes('1420')) {
      clearTimeout(timer);
      resolve();
    }
  });
});

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const shot of shots) {
  await page.goto(shot.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(shot.file === 'editor-tabs.png' ? 2500 : 1200);
  if (shot.file === 'explorer-tree.png') {
    const treeBtn = page.locator('[data-testid="explorer-panel"] button').nth(2);
    await treeBtn.click({ button: 'right' }).catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: path.join(outDir, shot.file), fullPage: false });
}

await browser.close();
server.kill();
console.log('Saved screenshots to', outDir);
