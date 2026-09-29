import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'packages', 'app');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 5210;
const BASE = `http://127.0.0.1:${PORT}`;

function waitForServer(timeoutMs = 90_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(`${BASE}/`, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else if (Date.now() - start > timeoutMs) reject(new Error('server timeout'));
          else setTimeout(tick, 300);
        })
        .on('error', () => {
          if (Date.now() - start > timeoutMs) reject(new Error('server timeout'));
          else setTimeout(tick, 300);
        });
    };
    tick();
  });
}

async function assertNotBlank(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 8_000) {
    throw new Error(`screenshot too small (likely blank): ${file}`);
  }
}

async function shot(page, name, setup) {
  await setup(page);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  await assertNotBlank(file);
  console.log('wrote', file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const dev = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: APP,
    shell: true,
    stdio: 'ignore',
  });
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await shot(page, 'integrated-agent.png', async (p) => {
      await p.goto(`${BASE}/?demo&session=demo-sess-parent&pane=demo-opencode-1`);
      await p.getByTestId('sidebar-sessions').waitFor({ state: 'visible', timeout: 60_000 });
      await p.getByTestId('transcript-scroll').waitFor({ state: 'visible', timeout: 60_000 });
      await p.locator('[data-agent-composer]').waitFor({ state: 'visible', timeout: 60_000 });
    });

    await shot(page, 'integrated-editor.png', async (p) => {
      await p.goto(`${BASE}/?demo&shot=editor-tabs&panel=open`);
      await p.getByTestId('editor-workspace').waitFor({ state: 'visible', timeout: 60_000 });
      await p.getByTestId('monaco-editor-pane-loading').waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {});
      await p.getByTestId('monaco-editor-pane').waitFor({ state: 'visible', timeout: 90_000 });
      await p.getByTestId('bottom-panel-host').waitFor({ state: 'visible', timeout: 60_000 });
    });

    await shot(page, 'integrated-palette.png', async (p) => {
      await p.goto(`${BASE}/?demo&palette=1`);
      await p.getByTestId('command-palette').waitFor({ state: 'visible', timeout: 60_000 });
      await p.getByText('Editor', { exact: false }).first().waitFor({ timeout: 30_000 });
      await p.getByText('Session', { exact: false }).first().waitFor({ timeout: 30_000 });
    });

    await browser.close();
  } finally {
    dev.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
