/**
 * E2E: Approve & invite must land on Job Progress with the new job visible.
 *
 *   VITE_DEMO=1 npm run dev -- --host --port 5174
 *   node scripts/e2e-approve-handoff.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5174';
const OUT = process.env.SMOKE_OUT ?? new URL('../.smoke', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const uniqueTitle = `E2E Meridian ${Date.now().toString(36)}`;

try {
  // Demo MemoryRouter reads the entry once from localStorage.
  await page.addInitScript((route) => {
    localStorage.setItem('atmosphere.route', route);
  }, '/intake');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  // If StrictMode / home redirect won the race, force intake via demo bridge.
  const onIntake = await page
    .getByRole('heading', { name: 'Start a job' })
    .isVisible()
    .catch(() => false);
  if (!onIntake) {
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('atmosphere:navigate', { detail: '/intake' }));
    });
  }
  await page.getByRole('heading', { name: 'Start a job' }).waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `${OUT}/01-intake.png` });

  // Address + sample scope → review
  const address = page.getByPlaceholder(/Start typing a street address|Meridian Ave/i).first();
  await address.fill('1842 Meridian Ave, Austin, TX 78702');
  await page.getByRole('button', { name: /Use a sample scope/i }).click();
  await page.getByRole('button', { name: /^Next$/i }).click();

  await page.getByRole('heading', { name: /Review before anyone sees it/i }).waitFor({
    timeout: 15_000,
  });
  // Make the job title unique so we can assert it later.
  const titleInput = page.locator('label:has-text("Job title") input').first();
  await titleInput.fill(uniqueTitle);
  await page.screenshot({ path: `${OUT}/02-review.png` });

  const approve = page.getByRole('button', { name: /Approve & invite|Publish brief/i });
  await approve.click();

  // Must land on Job Progress with the job painted (not empty library).
  await page.getByRole('heading', { name: 'Job Progress' }).waitFor({ timeout: 15_000 });
  await page.getByText('Job created').waitFor({ timeout: 10_000 });
  await page.getByText(uniqueTitle).first().waitFor({ timeout: 10_000 });
  await page.screenshot({ path: `${OUT}/03-job-progress.png` });

  const body = await page.locator('body').innerText();
  const hasEmptyLibrary = /No clips yet/i.test(body) && !/Job Progress/i.test(body);
  if (hasEmptyLibrary) {
    throw new Error('Landed on empty video library instead of Job Progress');
  }
  if (!body.includes(uniqueTitle)) {
    throw new Error(`Job title "${uniqueTitle}" not visible on Job Progress`);
  }
  if (!body.includes('Job created')) {
    throw new Error('Missing "Job created" success banner');
  }

  console.log('PASS: Approve & invite opened Job Progress with', uniqueTitle);
  console.log('screenshots:', `${OUT}/01-intake.png`, `${OUT}/02-review.png`, `${OUT}/03-job-progress.png`);
  if (errors.length) {
    console.log('console noise (non-fatal):', errors.slice(0, 5));
  }
  await browser.close();
  process.exit(0);
} catch (err) {
  await page.screenshot({ path: `${OUT}/FAIL-approve-handoff.png` }).catch(() => {});
  console.error('FAIL:', err instanceof Error ? err.message : err);
  console.error('page url:', page.url());
  console.error('body snippet:', (await page.locator('body').innerText().catch(() => '')).slice(0, 800));
  if (errors.length) console.error('errors:', errors.slice(0, 8));
  await browser.close();
  process.exit(1);
}
