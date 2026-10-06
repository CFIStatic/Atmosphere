import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const base = 'http://127.0.0.1:5179/__screens__/hd-order';
mkdirSync('/workspace/screens/hd-order', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 2 });

const resp = await page.goto(base, { waitUntil: 'networkidle', timeout: 60000 });
console.log('status', resp?.status());
const err = await page.locator('text=Something went').count();
const bodyText = await page.locator('body').innerText().catch(() => '');
console.log('body head:', bodyText.slice(0, 300));

await page.waitForSelector('[data-testid="computer-materials-list"]', { timeout: 20000 });
await page.waitForSelector('[data-testid="computer-approval-card"]', { timeout: 20000 });

const materials = page.locator('[data-testid="materials-shot"]');
await materials.screenshot({ path: '/workspace/screens/hd-order/materials-list-v2.png' });

const approve = page.locator('[data-testid="approve-shot"]');
await approve.screenshot({ path: '/workspace/screens/hd-order/approve-card-v2.png' });

// Full page for context
await page.screenshot({ path: '/workspace/screens/hd-order/hd-order-full-v2.png', fullPage: true });

console.log('title', await page.locator('[data-testid="computer-approval-title"]').innerText());
console.log('materials rows', await page.locator('[data-testid="materials-row"]').count());
console.log('approve fields', await page.locator('[data-testid="computer-approval-field"]').count());
console.log('source chips', await page.locator('[data-testid="ask-source-chip"]').count());

await browser.close();
console.log('done');
