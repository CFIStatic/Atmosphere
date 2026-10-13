// Before/after screenshots for the Tailwind v4 upgrade (dev tool, not shipped).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const OUT = process.env.OUT ?? '/workspace/tailwind-v4-shots';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const FREEZE = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
const VIEWS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const FE = [['login', '/login'], ['dashboard', '/dashboard'], ['jobs', '/verifier-library'], ['job-file', '/jobs/job-1038'], ['settings', '/settings'], ['logins', '/logins']];
const IN = [['login', '/login', true], ['overview', '/overview'], ['growth', '/growth'], ['capture', '/capture'], ['ai', '/ai'], ['accounts', '/accounts'], ['usage', '/usage'], ['token-usage', '/token-usage'], ['ai-budgets', '/ai-budgets'], ['system', '/system']];
const apps = [['frontend', FE, { before: 6101, after: 6102 }], ['internal', IN, { before: 6201, after: 6202 }]].filter(([a]) => !process.env.APPS || process.env.APPS.split(',').includes(a));
for (const [app, pages, ports] of apps) for (const [which, port] of Object.entries(ports).filter(([w]) => !process.env.ONLY || w === process.env.ONLY)) for (const [vname, vp] of Object.entries(VIEWS)) for (const theme of ['light', 'dark']) {
  const dir = `${OUT}/${which}/${app}`; mkdirSync(dir, { recursive: true });
  for (const [name, route, signedOut] of pages) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    if (signedOut) await ctx.addCookies([{ name: 'mock_signed_out', value: '1', url: `http://localhost:${port}` }]);
    await ctx.addInitScript(([t, r]) => { localStorage.setItem('atmosphere.theme', t); localStorage.setItem('atmosphere.route', r); }, [theme, route]);
    // Frontend demo build: no live API, so answer 401 and let the in-app fixtures serve.
    if (app === 'frontend') await ctx.route('**/api/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}${app === 'internal' ? route : '/'}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.addStyleTag({ content: FREEZE }); await page.waitForTimeout(1500);
    const base = `${dir}/${name}-${vname}-${theme}`;
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    if (name === 'job-file') {
      const tabs = await page.getByRole('tab').all();
      for (let i = 0; i < Math.min(tabs.length, 8); i++) {
        const label = ((await tabs[i].innerText().catch(() => '')) || `tab${i}`).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
        if (!(await tabs[i].isVisible())) continue;
        await tabs[i].click().catch(() => {}); await page.waitForTimeout(800);
        await page.screenshot({ path: `${base.replace('job-file', `job-file-tab-${i}-${label}`)}.png`, fullPage: true });
      }
    }
    await ctx.close();
  }
}
await browser.close();
