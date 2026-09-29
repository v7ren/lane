import { chromium } from 'playwright';

const port = process.env.VITE_PORT ?? '1421';
const base = `http://127.0.0.1:${port}`;
const urls = [
  `${base}/?demo`,
  `${base}/?demo&shot=editor-tabs`,
  `${base}/?demo&shot=review`,
  `${base}/?demo&shot=conflict-banner`,
];

const browser = await chromium.launch();
for (const url of urls) {
  const page = await browser.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`PAGE: ${e.message}\n${e.stack}`));
  page.on('console', (m) => {
    if (m.type() === 'error') logs.push(`CON: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4000);
  const shell = await page.locator('[data-testid="app-shell"]').count();
  const review = await page.locator('[data-testid="review-panel"]').count();
  const banner = await page.locator('[data-testid="conflict-banner"]').count();
  const monaco = await page.locator('.monaco-editor').count();
  console.log('\n===', url, '===');
  console.log('app-shell:', shell, 'review:', review, 'banner:', banner, 'monaco:', monaco);
  console.log('errors:', logs.length ? logs.join('\n') : '(none)');
}
await browser.close();
