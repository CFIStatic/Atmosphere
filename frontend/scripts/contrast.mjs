import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const json = (b) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });

function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}
const parse = (s) => s.match(/\d+/g).slice(0, 3).map(Number);

for (const theme of ['dark', 'light']) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.route('**/api/auth/me', (r) => r.fulfill(json({ user: { id: 'u-1', email: 'dana@atmosphere.test', createdAt: new Date().toISOString(), lastSignInAt: null, emailConfirmed: true, metadata: {} } })));
  await page.route('**/api/org/me', (r) => r.fulfill(json({ membership: { role: 'project_manager', workType: 'mitigation', status: 'active', org: { id: 'o-1', name: 'Lone Star', joinCode: 'X' } } })));
  await page.route('**/api/auth/pin/status', (r) => r.fulfill(json({ enrolled: false })));
  await page.route('**/api/org/members', (r) => r.fulfill(json({ members: [] })));
  await page.addInitScript((t) => localStorage.setItem('atmosphere.theme', t), theme);
  await page.goto('http://localhost:4173/overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);

  const results = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    // Walk visible text nodes and record fg/bg pairs.
    for (const el of document.querySelectorAll('h1,h2,h3,p,span,a,button,td,th,li,label')) {
      const text = el.textContent?.trim();
      if (!text || text.length > 60 || el.children.length > 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cs = getComputedStyle(el);
      // Composite the full ancestor chain. Without this, translucent badge
      // fills are compared against themselves and report a bogus 1:1.
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const m = c && c.match(/[\d.]+/g);
        if (!m) continue;
        const a = m.length > 3 ? parseFloat(m[3]) : 1;
        if (a > 0) layers.push([+m[0], +m[1], +m[2], a]);
        if (a === 1) break;
      }
      let acc = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i--) {
        const [r, g, b, a] = layers[i];
        acc = [r * a + acc[0] * (1 - a), g * a + acc[1] * (1 - a), b * a + acc[2] * (1 - a)];
      }
      const bg = `rgb(${acc.map(Math.round).join(', ')})`;
      const key = cs.color + '|' + bg + '|' + cs.fontSize;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ sample: text.slice(0, 28), color: cs.color, bg, size: parseFloat(cs.fontSize) });
    }
    return out;
  });

  const fails = results
    .map((r) => ({ ...r, cr: ratio(parse(r.color), parse(r.bg)) }))
    .filter((r) => r.cr < (r.size >= 18 ? 3 : 4.5))
    .sort((a, b) => a.cr - b.cr);

  console.log(`\n${theme.toUpperCase()} — ${results.length} distinct pairs, ${fails.length} below WCAG AA`);
  fails.slice(0, 8).forEach((f) => console.log(`  ${f.cr.toFixed(2)}:1  ${f.size}px  "${f.sample}"  ${f.color} on ${f.bg}`));
  await ctx.close();
}
await browser.close();
