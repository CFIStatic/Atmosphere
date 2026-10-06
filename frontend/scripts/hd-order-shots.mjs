// Screenshots of the HD materials + Approve cards from the local UI.
// Usage (from frontend/): node scripts/hd-order-shots.mjs v3
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const tag = process.argv[2] || 'v3';
const out = '/workspace/screens/hd-order';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 1400 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5179/__screens__/hd-order', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('[data-testid="computer-materials-list"]');
await page.waitForSelector('[data-testid="computer-approval-card"]');

const shot = page.locator('[data-testid="approve-shot"]');
const line = (material) => page.locator('[data-testid="order-line"]', { hasText: `For ${material}` });
const approveLabel = async () => ({
  button: await page.locator('[data-testid="computer-approval-approve"]').innerText(),
  summary: await page.locator('[data-testid="order-live-summary"]').innerText(),
  total: await page.locator('[data-testid="order-total-amount"]').innerText(),
});
const caption = (text) =>
  page.evaluate((t) => { document.querySelector('[data-testid="example-caption"]').textContent = t; }, text);
const report = {};

await page.locator('[data-testid="materials-shot"]').screenshot({ path: `${out}/materials-list-${tag}.png` });

// 1) Default state: only ready lines are checked.
await shot.screenshot({ path: `${out}/approve-card-${tag}.png` });
report.default = await approveLabel();
await page.screenshot({ path: `${out}/hd-order-full-${tag}.png`, fullPage: true });

// 2) Everything checked: confirm flagged lines, type example quantities for unknown-qty lines.
const typed = { 'birch plywood': 2, 'construction adhesive': 2, 'crown molding': 4, caulk: 2, 'finished nails': 1 };
for (const [m, q] of Object.entries(typed)) await line(m).locator('[data-testid="order-line-qty-input"]').fill(String(q));
for (const m of ['base cabinet', 'crown molding', 'finished nails']) {
  const box = line(m).locator('[data-testid="order-line-check"]');
  if (!(await box.isChecked())) await box.check();
}
await caption(
  'Screenshot state: quantities for plywood (2), adhesive (2), crown molding (4), caulk (2) and nails (1) were typed in for this example; flagged lines were checked by hand.',
);
await shot.screenshot({ path: `${out}/approve-card-all-checked-${tag}.png` });
report.allChecked = await approveLabel();

// 3) One line unchecked.
await line('crown molding').locator('[data-testid="order-line-check"]').uncheck();
await caption(
  'Screenshot state: same example quantities as above, with crown molding unchecked. It is left out of the total and would be removed from the Home Depot cart before checkout.',
);
await shot.screenshot({ path: `${out}/approve-card-one-unchecked-${tag}.png` });
report.oneUnchecked = await approveLabel();
report.oneUncheckedTotal = await page.locator('[data-testid="order-total-amount"]').innerText();

// 4) Details expanded (default selection, fresh load).
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid="computer-approval-card"]');
await page.locator('[data-testid="order-details"] summary').click();
await shot.screenshot({ path: `${out}/approve-card-details-${tag}.png` });

const approve = await shot.innerText();
Object.assign(report, {
  title: await page.locator('[data-testid="computer-approval-title"]').innerText(),
  materialsRows: await page.locator('[data-testid="materials-row"]').count(),
  materialsHeaders: await page.locator('[data-testid="materials-table"] th').allInnerTexts(),
  chips: await page.locator('[data-testid="ask-source-chip"]').count(),
  orderLines: await page.locator('[data-testid="order-line"]').count(),
  notAdded: await page.locator('[data-testid="order-not-added"]').innerText(),
  rawUrlInRows: /https?:\/\//.test(await page.locator('[data-testid="order-lines"]').innerText()),
  nothingPurchasedCount: (approve.match(/Nothing is purchased/g) || []).length,
});
console.log(JSON.stringify(report, null, 2));
await browser.close();
