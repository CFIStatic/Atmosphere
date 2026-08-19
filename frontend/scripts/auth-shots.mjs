/**
 * Captures every authentication surface in both themes.
 *
 * Auth is deliberately NOT stubbed for most of these: /api/auth/me must 401 so
 * the app actually lands on the sign-in screen instead of redirecting past it.
 */
import { chromium } from 'playwright';

const OUT = process.env.SMOKE_OUT ?? '/tmp/out';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
});
const json = (b, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(b) });
const errors = [];

for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  await page.addInitScript((t) => localStorage.setItem('atmosphere.theme', t), theme);

  // Signed out.
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ error: 'Not authenticated' }, 401)));
  await page.route('**/api/auth/pin/status', (r) => r.fulfill(json({ enrolled: false })));
  await page.route('**/api/auth/forgot-password', (r) =>
    r.fulfill(json({ ok: true, message: 'If an account exists for that address, a reset link is on its way.' })));

  const shot = async (name) => {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/auth-${theme}-${name}.png` });
    console.log(`  ${theme}/${name}`);
  };

  // 1 — Sign in
  await page.goto('http://localhost:4173/login', { waitUntil: 'networkidle' });
  await page.fill('#email', 'dana@lonestar-restoration.com');
  await page.fill('#password', 'correct-horse-battery');
  await shot('signin');

  // 2 — Create account
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.fill('#email', 'marcus@lonestar-restoration.com');
  await page.fill('#password', 'correct-horse-battery');
  await shot('signup');

  // 3 — Forgot password
  await page.goto('http://localhost:4173/forgot-password', { waitUntil: 'networkidle' });
  await page.fill('#email', 'dana@lonestar-restoration.com');
  await shot('forgot');

  // 4 — Link sent confirmation
  await page.getByRole('button', { name: /send reset link/i }).click();
  await shot('forgot-sent');

  // 5 — Choose a new password
  await page.goto('http://localhost:4173/reset-password?token_hash=demo-token', { waitUntil: 'networkidle' });
  await page.fill('#new-password', 'correct-horse-battery');
  await page.fill('#confirm-password', 'correct-horse-battery');
  await shot('reset');

  // 6 — Expired link
  await page.goto('http://localhost:4173/reset-password?error_description=Link+has+expired', { waitUntil: 'networkidle' });
  await shot('reset-expired');

  // 7 — PIN unlock (device already enrolled on this browser)
  await page.unroute('**/api/auth/pin/status');
  await page.route('**/api/auth/pin/status', (r) => r.fulfill(json({ enrolled: true, lockedUntil: null })));
  await page.goto('http://localhost:4173/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  for (const d of ['8', '3', '0']) await page.getByRole('button', { name: d, exact: true }).click();
  await shot('pin');

  await ctx.close();
}

console.log('\npage errors:', errors.length);
errors.forEach((e) => console.log('  !', e));
await browser.close();
