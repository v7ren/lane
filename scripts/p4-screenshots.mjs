import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');

async function shot(page, name) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:5173/?demo', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="sidebar-sessions"]');
  await page.screenshot({ path: path.join(outDir, name) });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await shot(page, 'sessions-sidebar.png');

  await page.fill('[data-testid="session-search"]', 'MCP');
  await page.screenshot({ path: path.join(outDir, 'sessions-sidebar.png') });

  await page.locator('[data-testid="session-row"]').first().locator('button[aria-label="Session menu"]').click();
  await page.waitForSelector('[data-testid="session-context-menu"]');
  await page.screenshot({ path: path.join(outDir, 'session-menu.png') });

  await page.keyboard.press('Escape');
  await page.locator('[data-testid="right-rail"] button', { hasText: 'Session' }).click();
  await page.screenshot({ path: path.join(outDir, 'right-rail-session.png') });

  await page.locator('[data-testid="right-rail"] button', { hasText: 'Environment' }).click();
  await page.screenshot({ path: path.join(outDir, 'right-rail-environment.png') });

  await page.locator('[data-testid="session-row"]').first().click();
  await page.waitForSelector('[data-testid="revert-banner"]');
  await page.screenshot({ path: path.join(outDir, 'revert-banner.png') });

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
