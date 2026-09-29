import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(root, '../docs/screenshots');
const base = 'http://127.0.0.1:1420';

const shots = [
  {
    file: 'fix-tui-column.png',
    url: `${base}/?demo&tui=1&bottom=agent&panel=1`,
    ready: '[data-testid="agent-tui-header"]',
  },
  {
    file: 'fix-terminal-tabs.png',
    url: `${base}/?demo&panel=1`,
    ready: '[data-testid="app-shell"]',
    after: async (page) => {
      await page.locator('[data-testid="bottom-tab-terminal"]').click();
      await page.waitForSelector('[data-testid="terminal-shell-bar"]', { state: 'visible', timeout: 30_000 });
      const newBtn = page.locator('[aria-label="New shell"]');
      if (await newBtn.isVisible()) {
        await newBtn.click();
        await page.waitForTimeout(800);
      }
    },
  },
  {
    file: 'fix-read-card.png',
    url: `${base}/?demo&bottom=agent&panel=1`,
    ready: '[data-testid="transcript-scroll"]',
  },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const shot of shots) {
  await page.goto(shot.url, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForSelector(shot.ready, { timeout: 60_000 });
  if (shot.after) await shot.after(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, shot.file), fullPage: false });
  console.log('wrote', shot.file);
}

await browser.close();
