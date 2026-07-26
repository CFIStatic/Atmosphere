import { chromium } from 'playwright';
const OUT = process.env.SMOKE_OUT ?? '/tmp/out';
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const json = (b) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  await page.addInitScript((t) => localStorage.setItem('atmosphere.theme', t), theme);
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ user: { id: 'u-1', email: 'sofia@lonestar-restoration.com', createdAt: new Date().toISOString(), lastSignInAt: null, emailConfirmed: true, metadata: {} } })));
  await page.route('**/api/org/me', (r) => r.fulfill(json({ membership: { role: 'office_manager', workType: 'mitigation', status: 'active', org: { id: 'o-1', name: 'Lone Star Restoration', joinCode: 'LSR7742' } } })));
  await page.route('**/api/auth/pin/status', (r) => r.fulfill(json({ enrolled: false })));
  await page.route('**/api/org/members', (r) => r.fulfill(json({ members: [] })));

  await page.goto('http://localhost:4173/connections', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${OUT}/connections-${theme}.png` });
  const cards = await page.locator('h3').count();
  console.log(`${theme}: ${cards} apps rendered · h1="${await page.locator('h1').first().textContent()}"`);
  console.log(`  ${await page.locator('p').filter({ hasText: 'connected ·' }).first().textContent()}`);

  if (theme === 'dark') {
    await page.getByRole('button', { name: /Xactimate/ }).first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/connections-drawer.png` });
    console.log('  drawer opened');
  }
  await ctx.close();
}
console.log('page errors:', errors.length);
errors.forEach((e) => console.log('  !', e));
await browser.close();
