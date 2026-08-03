/**
 * Boot smoke test.
 *
 * Renders the built app in a real browser with the BFF stubbed, so it exercises
 * what a unit test cannot: provider ordering, router wiring, lazy chunk loading,
 * and whether every page actually mounts without a runtime error.
 *
 *   npm run build && npm run preview &
 *   CHROMIUM_PATH=/path/to/chrome npm run smoke
 */
import { chromium } from 'playwright';

// Screenshots land in a gitignored folder; override with SMOKE_OUT.
const SCRATCH = process.env.SMOKE_OUT ?? new URL('../.smoke', import.meta.url).pathname;
const { mkdirSync } = await import('node:fs');
mkdirSync(SCRATCH, { recursive: true });
const errors = [];

const browser = await chromium.launch({
  // The sandbox pins a Chromium build older than the Playwright package
  // expects, so point at it explicitly rather than downloading another.
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// Stub the BFF so the command center renders without a reachable Supabase.
await page.route('**/api/auth/me', (r) => r.fulfill(json({
  user: { id: 'u-1', email: 'dana@atmosphere.test', createdAt: new Date().toISOString(),
          lastSignInAt: null, emailConfirmed: true, metadata: {} },
})));
await page.route('**/api/org/me', (r) => r.fulfill(json({
  membership: { role: 'project_manager', workType: 'mitigation', status: 'active',
                org: { id: 'o-1', name: 'Lone Star Restoration', joinCode: 'LSR7742' } },
})));
await page.route('**/api/auth/pin/status', (r) => r.fulfill(json({ enrolled: false })));
await page.route('**/api/org/members', (r) => r.fulfill(json({ members: [] })));

const shots = [];
async function visit(path, name, waitFor) {
  await page.goto(`http://localhost:4173${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  if (waitFor) await page.locator(waitFor).first().waitFor({ timeout: 5000 }).catch(() => {});
  const file = `${SCRATCH}/${name}.png`;
  await page.screenshot({ path: file });
  shots.push(file);
  const h1 = await page.locator('h1').first().textContent().catch(() => null);
  console.log(`${path.padEnd(14)} → h1: ${h1}`);
}

await visit('/overview', 'overview', 'text=Needs attention');
await visit('/approvals', 'approvals', 'text=Proposed changes');
await visit('/jobs', 'jobs', 'text=WTR-1041');
await visit('/jobs/j-1041', 'job-workspace', 'text=Timeline');
await visit('/agents', 'agents', 'text=Scheduling');
await visit('/financials', 'financials');

// Assistant panel present on a desktop viewport?
await page.goto('http://localhost:4173/overview', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
console.log('assistant panel :', await page.locator('aside[aria-label="Atmosphere assistant"]').isVisible().catch(() => false));
console.log('left nav        :', await page.locator('nav[aria-label="Main"]').isVisible().catch(() => false));
console.log('command bar     :', await page.locator('text=Ask Atmosphere or jump to').isVisible().catch(() => false));

// Mobile viewport: bottom bar should appear.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto('http://localhost:4173/my-work', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: `${SCRATCH}/mobile-my-work.png` });
shots.push(`${SCRATCH}/mobile-my-work.png`);
console.log('mobile bottombar:', await page.locator('nav[aria-label="Primary"]').isVisible().catch(() => false));

const real = errors.filter((e) => !/401|Failed to load resource|net::ERR/.test(e));
console.log('\nconsole errors  :', real.length);
real.slice(0, 6).forEach((e) => console.log('  !', e));
console.log('screenshots     :', shots.length);

await browser.close();
process.exit(real.length ? 1 : 0);
