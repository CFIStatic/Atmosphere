import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');
const verifierFrame = readFileSync(resolve(here, '../VerifierFrame.tsx'), 'utf8');

describe('verifier office rail', () => {
  it('lists Overview, Start a job, Dashboard, and Job Files', () => {
    const nav = verifierHtml.match(
      /<div class="rail-section" id="platform-nav" hidden>[\s\S]*?<\/div>/,
    );
    expect(nav).not.toBeNull();
    const labels = [...nav![0].matchAll(/<span class="label">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Overview', 'Start a job', 'Dashboard', 'Job Files']);
    expect(nav![0]).toContain('data-route="/field"');
    expect(nav![0]).not.toContain('data-route="/my-work"');
    expect(nav![0]).toContain('data-screen="dashboard"');
    expect(nav![0]).toContain('data-route="/jobs"');
    expect(nav![0]).not.toContain('>Field<');
  });

  it('hands Overview and Job Files to the office shell', () => {
    expect(verifierHtml).toContain("goShell('/field')");
    expect(verifierHtml).toContain("to: '/settings'");
    expect(verifierHtml).not.toContain("goShell('/my-work')");
    expect(verifierHtml).toContain("goShell('/jobs')");
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
    expect(verifierHtml).not.toContain('tbody tr, tr.jobrow {\n      margin: 0 0 10px');
  });

  it('loads the org library with the Field Capture Bearer token', () => {
    expect(verifierHtml).toContain("atmosphere.fieldEmbed.accessToken");
    expect(verifierHtml).toContain('function apiFetch');
    expect(verifierHtml).toContain("apiFetch('/api/evidence-portal/library'");
    expect(verifierHtml).toContain('Email invite');
  });

  it('keeps the Videos filters on every office page, not only Dashboard', () => {
    expect(verifierHtml).toContain('id="evidence-nav"');
    expect(verifierHtml).toMatch(/<h3>Videos<\/h3>/);
    expect(verifierHtml).not.toMatch(
      /body\[data-atm-rail-only\]\s+#evidence-nav\s*\{[^}]*display:\s*none/,
    );
    expect(verifierHtml).toContain(
      "window.parent.postMessage({ atmosphere: 'navigate', to: '/verifier-library' }, '*');",
    );
  });

  it('does not show a Legal hold filter on the Dashboard', () => {
    expect(verifierHtml).not.toContain('data-view="hold"');
    expect(verifierHtml).not.toContain('id="n-hold"');
    expect(verifierHtml).not.toMatch(/data-label="Legal hold"/);
  });
});
