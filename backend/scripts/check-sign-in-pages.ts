/**
 * Readiness check for the "Add a login" catalog: opens every picker site's
 * official sign-in page in a browser and runs the same field detection and
 * "open the form" step the saved sign-in uses. It never types anything and
 * never submits a form.
 *
 *   npx tsx scripts/check-sign-in-pages.ts [chrome-path]
 *
 * Exit code 1 when a site with a live_page recipe shows no sign-in form.
 */
import { chromium } from 'playwright-core';
import { catalogSiteForHost, pickerSites, SITE_CATALOG } from '../src/computer/catalog/sites.js';
import { openSignInForm, signInFieldsVisible } from '../src/computer/providers/playwrightDriver.js';

async function waitForFields(page: import('playwright-core').Page, ms: number) {
  const end = Date.now() + ms;
  let fields = await signInFieldsVisible(page);
  // Keep looking for a username box when only the password shows yet (Square draws it later).
  while (!fields.username && Date.now() < end) {
    await page.waitForTimeout(1_000);
    fields = await signInFieldsVisible(page);
  }
  return fields;
}

const executablePath = process.argv[2] ?? process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath });
  const sites = [...pickerSites(), ...SITE_CATALOG.filter((s) => s.publicTestSite && s.signIn)];
  const rows: Array<{ id: string; ok: boolean; detail: string }> = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (next < sites.length) {
        const site = sites[next++];
        // A normal Chrome user agent, like Computer's hosted browser (some sites refuse "HeadlessChrome").
        const ctx = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        });
        const page = await ctx.newPage();
        try {
          await page.goto(site.signInUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          let fields = await waitForFields(page, site.signIn?.flow === 'open_first' ? 5_000 : 15_000);
          let opened = false;
          if (!fields.username && !fields.password && site.signIn?.flow === 'open_first') {
            opened = await openSignInForm(page, site.signIn.openWith ?? []);
            fields = await waitForFields(page, 15_000);
          }
          const host = new URL(page.url()).host;
          const sameSite = catalogSiteForHost(host)?.id === site.id || (site.signIn?.identityHosts ?? []).includes(host) || site.hosts.some((h) => host.endsWith(h.split('.').slice(-2).join('.')));
          const ok = fields.username || fields.password;
          rows.push({ id: site.id, ok, detail: `${site.signIn?.flow}${opened ? ' (opened)' : ''} host=${host}${sameSite ? '' : ' [identity provider]'} user=${fields.username} pw=${fields.password}` });
        } catch (e) {
          rows.push({ id: site.id, ok: false, detail: `error: ${String((e as Error).message).split('\n')[0].slice(0, 90)}` });
        }
        await ctx.close();
      }
    }),
  );
  await browser.close();
  let failed = 0;
  for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    const site = SITE_CATALOG.find((s) => s.id === r.id)!;
    const blocked = site.signIn?.checked === 'blocked_probe';
    const mark = r.ok ? 'READY' : blocked ? 'BLOCKS-BOTS' : 'NO-FORM';
    if (!r.ok && !blocked) failed += 1;
    console.log(`${mark.padEnd(12)} ${r.id.padEnd(18)} ${r.detail}`);
  }
  console.log(`\n${rows.length - failed}/${rows.length} ready (BLOCKS-BOTS: the page refuses automated browsers here; its URL and steps come from the site's own pages and help pages).`);
  process.exit(failed ? 1 : 0);
}

void main();
