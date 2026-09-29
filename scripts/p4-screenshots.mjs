import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');
const PORT = Number(process.env.P4_SCREENSHOT_PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}`;

async function shot(page, url, name, waitFor) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (waitFor) await page.waitForSelector(waitFor);
  await page.screenshot({ path: path.join(outDir, name) });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await shot(page, `${BASE}/?demo`, 'sessions-sidebar.png', '[data-testid="sidebar-sessions"]');

  await page.locator('[data-testid="session-row"]').first().hover();
  await page.locator('[data-testid="session-row"]').first().locator('button[aria-label="Session menu"]').click();
  await page.waitForSelector('[data-testid="session-context-menu"]');
  await page.screenshot({ path: path.join(outDir, 'session-menu.png') });

  await page.keyboard.press('Escape');
  await shot(
    page,
    `${BASE}/?demo&rail=session`,
    'right-rail-session.png',
    '[data-testid="right-rail-session"]',
  );

  await shot(
    page,
    `${BASE}/?demo&rail=environment`,
    'right-rail-environment.png',
    '[data-testid="right-rail-environment"]',
  );

  await shot(
    page,
    `${BASE}/?demo&revert=1&session=demo-sess-parent&panel=open&bottom=agent`,
    'revert-banner.png',
    '[data-testid="revert-banner"]',
  );

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
