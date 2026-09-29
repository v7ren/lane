import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'packages', 'app');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PORT = 5203;
const BASE = `http://127.0.0.1:${PORT}`;

function waitForServer(timeoutMs = 60_000) {
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

async function openDemoAgent(page, paneId) {
  await page.goto(`${BASE}/?demo=1&pane=${encodeURIComponent(paneId)}`);
  await page.getByTestId('session-rail').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByTestId('bottom-panel-host').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByTestId('bottom-tab-agent').click();
  const sessionBtn = page.locator(`[data-testid="session-rail"] button[title="${paneId}"]`);
  if (await sessionBtn.count()) {
    await sessionBtn.first().click();
  } else {
    await page.getByTestId('session-rail').getByRole('button').first().click();
  }
  await page.locator('[data-agent-composer]').waitFor({ state: 'visible', timeout: 60_000 });
}

async function shot(page, name, setup) {
  await setup(page);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log('wrote', file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: APP,
    shell: true,
    stdio: 'ignore',
  });
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await shot(page, 'transcript-flat.png', async (p) => {
      await openDemoAgent(p, 'demo-opencode-1');
      await p.getByTestId('transcript-scroll').waitFor({ state: 'visible', timeout: 60_000 });
      await p.getByTestId('user-turn').waitFor({ state: 'visible', timeout: 60_000 });
      await p.getByTestId('assistant-turn').waitFor({ state: 'visible', timeout: 60_000 });
      await p.getByTestId('meta-footer').waitFor({ state: 'visible', timeout: 60_000 });
      await p.getByTestId('permission-dock').waitFor({ state: 'visible', timeout: 60_000 });
    });

    await shot(page, 'permission-dock.png', async (p) => {
      await openDemoAgent(p, 'demo-opencode-1');
      await p.getByTestId('permission-dock').waitFor({ state: 'visible', timeout: 60_000 });
    });

    await shot(page, 'composer-pickers.png', async (p) => {
      await openDemoAgent(p, 'demo-opencode-1');
      await p.getByTestId('picker-model').waitFor({ state: 'visible', timeout: 60_000 });
      await p.getByTestId('picker-model').click();
      await p.getByTestId('model-popover').waitFor({ state: 'visible', timeout: 60_000 });
    });

    await shot(page, 'composer-mentions.png', async (p) => {
      await openDemoAgent(p, 'demo-opencode-1');
      const composer = p.locator('[data-agent-composer]');
      await composer.waitFor({ state: 'visible', timeout: 60_000 });
      await composer.click();
      await composer.fill('@bridge');
      await p.getByTestId('mention-popover').waitFor({ state: 'visible', timeout: 60_000 });
    });

    await shot(page, 'composer-codex.png', async (p) => {
      await openDemoAgent(p, 'demo-codex-1');
      await p.locator('[data-agent-composer]').waitFor({ state: 'visible', timeout: 60_000 });
      await p.getByText('native TUI mode').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
      await p.getByTestId('transcript-scroll').waitFor({ state: 'visible', timeout: 60_000 });
    });

    await browser.close();
  } finally {
    preview.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
