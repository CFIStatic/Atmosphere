import { chromium } from 'playwright';
const OUT = '/tmp/claude-0/-home-user-Commandx/ddfe7933-6a0b-5574-9ab1-1b8534ddf733/scratchpad';
const errors = [];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

const json = (b) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ user: { id: 'u-1', email: 'dana@atmosphere.test', createdAt: new Date().toISOString(), lastSignInAt: null, emailConfirmed: true, metadata: {} } })));
  await page.route('**/api/org/me', (r) => r.fulfill(json({ membership: { role: 'project_manager', workType: 'mitigation', status: 'active', org: { id: 'o-1', name: 'Lone Star Restoration', joinCode: 'LSR7742' } } })));
  await page.route('**/api/auth/pin/status', (r) => r.fulfill(json({ enrolled: false })));
  await page.route('**/api/org/members', (r) => r.fulfill(json({ members: [] })));
  await page.addInitScript((t) => localStorage.setItem('atmosphere.theme', t), theme);

  for (const [path, name] of [['/overview', 'overview'], ['/approvals', 'approvals'], ['/login', 'login']]) {
    await page.goto(`http://localhost:4173${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${theme}-${name}.png` });
  }
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log(`${theme.padEnd(6)} data-theme=${attr}  body bg=${bg}`);
  await ctx.close();
}
console.log('page errors:', errors.length);
errors.forEach((e) => console.log('  !', e));
await browser.close();
