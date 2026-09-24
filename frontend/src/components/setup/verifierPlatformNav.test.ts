import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');
const verifierFrame = readFileSync(resolve(here, '../VerifierFrame.tsx'), 'utf8');

describe('verifier office rail', () => {
  it('lists Start a job and Dashboard', () => {
    const nav = verifierHtml.match(
      /<div class="rail-section" id="platform-nav" hidden>[\s\S]*?<\/div>/,
    );
    expect(nav).not.toBeNull();
    const labels = [...nav![0].matchAll(/<span class="label"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Start a job', 'Dashboard']);
    expect(nav![0]).not.toContain('data-route="/field"');
    expect(nav![0]).not.toContain('data-route="/my-work"');
    expect(nav![0]).toContain('data-screen="dashboard"');
    expect(nav![0]).not.toContain('data-route="/jobs"');
    expect(nav![0]).not.toContain('>Field<');
  });

  it('hands Start a job to the office shell', () => {
    expect(verifierHtml).not.toContain("goShell('/field')");
    expect(verifierHtml).toContain("to: '/settings'");
    expect(verifierHtml).not.toContain("goShell('/my-work')");
    expect(verifierHtml).not.toContain("goShell('/jobs')");
    expect(verifierHtml).toContain("goShell('/intake')");
    expect(verifierHtml).toContain("atmosphere: 'navigate'");
  });

  it('opens a Dashboard job name as the job file', () => {
    expect(verifierHtml).toContain("var to = '/job-progress?job=' + encodeURIComponent(id);");
    expect(verifierHtml).toContain("to += '&title=' + encodeURIComponent(job.name);");
    expect(verifierHtml).not.toContain("var to = '/jobs/' + encodeURIComponent(id);");
    expect(verifierHtml).not.toContain("var to = '/jobs?job=' + encodeURIComponent(id);");
  });

  it('collapses the office rail into a phone drawer inside the Field Capture frame', () => {
    expect(verifierHtml).toContain('id="rail-menu"');
    expect(verifierHtml).toContain('@media (max-width: 640px)');
    expect(verifierHtml).toContain('html[data-rail-open]');
    expect(verifierHtml).toContain('function setRailOpen');
    expect(verifierHtml).toContain('min(280px, 86vw)');
    expect(verifierHtml).toContain('body[data-atm-rail-only] .app-frame.has-sidebar .rail');
    expect(verifierHtml).toMatch(
      /body\[data-atm-rail-only\]\s+\.app-frame\.has-sidebar\s+\.rail\s*\{[^}]*transform:\s*none/,
    );
  });

  it('keeps Dashboard desktop nav metrics on every office tab', () => {
    expect(verifierHtml).toContain(
      'body:not([data-atm-rail-only]) .navitem,\n    body[data-atm-phone-drawer] .navitem',
    );
    expect(verifierHtml).toContain(
      'body[data-atm-rail-only]:not([data-atm-phone-drawer]) .navitem',
    );
    expect(verifierHtml).toMatch(
      /body\[data-atm-rail-only\]:not\(\[data-atm-phone-drawer\]\)\s+\.navitem\s*\{[^}]*min-height:\s*0/,
    );
    expect(verifierHtml).toMatch(
      /body\[data-atm-rail-only\]:not\(\[data-atm-phone-drawer\]\)\s+\.navitem\s*\{[^}]*padding:\s*8px 10px/,
    );
    expect(verifierHtml).toMatch(
      /body\[data-atm-rail-only\]:not\(\[data-atm-phone-drawer\]\)\s+\.navitem\s*\{[^}]*font-size:\s*13px/,
    );
    expect(verifierHtml).toMatch(
      /body\[data-atm-rail-only\]:not\(\[data-atm-phone-drawer\]\)\s+\.navitem\.nav-icon\s+svg\s*\{[^}]*width:\s*16px/,
    );
    expect(verifierHtml).toContain('function setPhoneDrawer');
    expect(verifierHtml).toContain('d.phoneDrawer');
    expect(verifierFrame).toContain('phoneDrawer: phone && railOnly');
    expect(verifierFrame).toContain('usePhoneShell');
  });

  it('keeps the phone account chip identical to the desktop chip', () => {
    expect(verifierHtml).toContain('.topbar .spacer { display: none; }');
    expect(verifierHtml).toContain('.search {');
    expect(verifierHtml).toContain('flex: 1 1 100%');
    expect(verifierHtml).toContain('order: 5');
    expect(verifierHtml).toContain('.who .role { display: block; color: var(--faint); font-size: 11.5px; }');
    expect(verifierHtml).not.toMatch(/\.who \.role \{ display: none/);
    expect(verifierHtml).toContain('thead { display: none; }');
    expect(verifierHtml).toContain('table { table-layout: fixed; width: 100%; max-width: 100%; }');
  });

  it('packs All videos job files into compact phone cards', () => {
    expect(verifierHtml).toContain('class="job-card-meta"');
    expect(verifierHtml).toContain("'<tr class=\"cliprow'");
    expect(verifierHtml).toContain('cliprow-nested');
    expect(verifierHtml).toContain('td class="job-status"');
    expect(verifierHtml).toContain('Phone All videos: one compact card per job');
    expect(verifierHtml).toContain('tbody tr.jobrow td.job-status');
    expect(verifierHtml).toContain('display: none !important');
    expect(verifierHtml).toContain('-webkit-line-clamp: 2');
    expect(verifierHtml).toContain('job-title-split');
    expect(verifierHtml).toContain('tbody tr.jobrow td.titlecell .t-lead');
    expect(verifierHtml).toContain('tbody tr.jobrow td.titlecell .t-rest');
    expect(verifierHtml).toContain('padding-right: 104px');
    expect(verifierHtml).toMatch(
      /tbody tr\.jobrow td\.titlecell \.t-lead \{[^}]*height:\s*36px/,
    );
    expect(verifierHtml).not.toContain('padding: 12px 116px 12px 12px');
    expect(verifierHtml).not.toContain('tbody tr, tr.jobrow {\n      margin: 0 0 10px');
  });

  it('splits Site — work job names for the phone card title', () => {
    const start = verifierHtml.indexOf('function splitJobTitle(name)');
    const end = verifierHtml.indexOf('function jobTitleMarkup(name)');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const { splitJobTitle } = new Function(
      `${verifierHtml.slice(start, end)}; return { splitJobTitle };`,
    )() as { splitJobTitle: (name: string) => { lead: string; rest: string } };

    expect(splitJobTitle('Camden Court — HOA clubhouse rebuild')).toEqual({
      lead: 'Camden Court',
      rest: 'HOA clubhouse rebuild',
    });
    expect(splitJobTitle('Cedar Ridge — storm damage, roof tarp + rebuild')).toEqual({
      lead: 'Cedar Ridge',
      rest: 'storm damage, roof tarp + rebuild',
    });
    expect(splitJobTitle('Meridian Ave - water loss, Class 3')).toEqual({
      lead: 'Meridian Ave',
      rest: 'water loss, Class 3',
    });
    expect(splitJobTitle('Clubhouse-rebuild')).toEqual({
      lead: 'Clubhouse-rebuild',
      rest: '',
    });
    expect(splitJobTitle('Copy of Cedar Ridge — storm — phase 2')).toEqual({
      lead: 'Copy of Cedar Ridge',
      rest: 'storm — phase 2',
    });
  });

  it('loads the org library with the Field Capture Bearer token', () => {
    expect(verifierHtml).toContain("atmosphere.fieldEmbed.accessToken");
    expect(verifierHtml).toContain('function apiFetch');
    expect(verifierHtml).toContain("apiFetch('/api/evidence-portal/library'");
    expect(verifierHtml).toContain('Email invite');
    expect(verifierHtml).toContain('function startLibraryWatch');
    expect(verifierHtml).toContain("atmosphere === 'reload-library'");
    expect(verifierHtml).toContain("createdAt: j.createdAt || ''");
  });

  it('keeps Chat history on the job file rail without a Videos section', () => {
    expect(verifierHtml).toContain('id="ask-history-nav"');
    expect(verifierHtml).toContain('data-i18n-chrome="chatHistory"');
    expect(verifierHtml).toContain('data-i18n-chrome="newChat"');
    expect(verifierHtml).toContain("d.atmosphere === 'ask-history'");
    expect(verifierHtml).toContain("atmosphere: 'ask-history-action'");
    expect(verifierHtml).toContain('startAskHistoryRename');
    expect(verifierHtml).toContain("type: 'rename-thread'");
    expect(verifierHtml).toContain('ask-hist-rename');
    expect(verifierHtml).not.toContain('id="evidence-nav"');
    expect(verifierHtml).not.toMatch(/<h3[^>]*>Videos<\/h3>/);
    expect(verifierHtml).not.toContain('data-i18n-chrome="videos"');
    expect(verifierHtml).not.toContain('data-i18n-chrome="allVideos"');
    expect(verifierHtml).not.toContain('data-i18n-chrome="classified"');
    expect(verifierHtml).not.toContain('data-i18n-chrome="awaitingAnalysis"');
    expect(verifierHtml).not.toContain('data-i18n-chrome="needsReview"');
    expect(verifierHtml).not.toContain('id="n-all"');
    expect(verifierHtml).toContain(
      "window.parent.postMessage({ atmosphere: 'navigate', to: '/verifier-library' }, '*');",
    );
  });

  it('applies locale chrome to Chat history labels on the rail', () => {
    const start = verifierHtml.indexOf('function applyChromeI18n(chrome, locale)');
    const end = verifierHtml.indexOf('function labelThemeToggle');
    if (start < 0 || end <= start) {
      throw new Error('Could not find applyChromeI18n in verifier/index.html');
    }
    expect(verifierHtml).toContain('id="ask-history-nav"');
    const dom = new JSDOM(`<!doctype html><html><body>
      <div class="rail-section" id="ask-history-nav">
        <h3 data-i18n-chrome="chatHistory">Chat history</h3>
        <button type="button" class="navitem nav-icon" id="ask-new-chat">
          <span class="label" data-i18n-chrome="newChat">New chat</span>
        </button>
        <div id="ask-history-list"></div>
      </div>
    </body></html>`);
    const apply = new Function(
      'document',
      'state',
      `${verifierHtml.slice(start, end)}
       function labelAllThemeToggles() {}
       function readThemePref() { return 'light'; }
       var chromeI18n = null;
       return applyChromeI18n;`,
    )(dom.window.document, { view: 'all' }) as (
      chrome: Record<string, string>,
      locale: string,
    ) => void;

    apply(
      {
        chatHistory: 'Historial de chats',
        newChat: 'Nuevo chat',
      },
      'es',
    );

    const { document } = dom.window;
    expect(document.documentElement.lang).toBe('es');
    expect(document.querySelector('[data-i18n-chrome="chatHistory"]')?.textContent).toBe(
      'Historial de chats',
    );
    expect(document.querySelector('[data-i18n-chrome="newChat"]')?.textContent).toBe('Nuevo chat');
  });

  it('keeps untranslated Dashboard chrome LTR when the nav locale is RTL', () => {
    expect(verifierHtml).toContain("document.documentElement.dir = 'ltr'");
    expect(verifierHtml).toContain("rail.dir = locale === 'ar' || locale === 'he' ? 'rtl' : 'ltr'");
    expect(verifierHtml).not.toContain(
      "document.documentElement.dir = locale === 'ar' || locale === 'he' ? 'rtl' : 'ltr'",
    );
  });


  it('keeps the office rail always expanded with no collapse toggle', () => {
    expect(verifierHtml).not.toContain('id="rail-collapse"');
    expect(verifierHtml).not.toContain('class="rail-collapse"');
    expect(verifierHtml).not.toContain('html[data-rail-collapsed]');
    expect(verifierHtml).not.toContain('function setRailCollapsed');
    expect(verifierHtml).not.toContain("atmosphere: 'rail-collapsed'");
    expect(verifierHtml).not.toContain('data-i18n-chrome-aria="collapseNav"');
    expect(verifierHtml).not.toContain('--rail-w: 56px');
    expect(verifierHtml).not.toContain('class="icon-collapse"');
    expect(verifierHtml).not.toContain('class="icon-expand"');
    // Stale localStorage key is cleared so users are never stuck collapsed.
    expect(verifierHtml).toContain("localStorage.removeItem('atmosphere.officeRailCollapsed')");
    expect(verifierHtml).toContain('id="brand-home"');
    expect(verifierHtml).toContain('id="nav-start-job"');
    expect(verifierHtml).toContain('data-screen="dashboard"');
    expect(verifierHtml).toContain('id="nav-settings"');
  });

  it('does not show a Legal hold filter on the Dashboard', () => {
    expect(verifierHtml).not.toContain('data-view="hold"');
    expect(verifierHtml).not.toContain('id="n-hold"');
    expect(verifierHtml).not.toMatch(/data-label="Legal hold"/);
    expect(verifierHtml).not.toContain('chip hold');
    expect(verifierHtml).not.toContain('>Legal hold</span>');
  });
});
