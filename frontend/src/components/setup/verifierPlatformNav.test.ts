import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('verifier office rail', () => {
  it('lists Overview, Start a job, Dashboard, and My jobs', () => {
    const nav = verifierHtml.match(/<div class="rail-section" id="platform-nav" hidden>[\s\S]*?<\/div>/);
    expect(nav).not.toBeNull();
    const labels = [...nav![0].matchAll(/<span class="label">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Overview', 'Start a job', 'Dashboard', 'My jobs']);
    expect(nav![0]).toContain('data-route="/field"');
    expect(nav![0]).toContain('data-screen="dashboard"');
    expect(nav![0]).toContain('data-route="/jobs"');
    expect(nav![0]).not.toContain('>Field<');
  });

  it('hands Overview and My jobs to the office shell', () => {
    expect(verifierHtml).toContain("goShell('/field')");
    expect(verifierHtml).toContain("goShell('/jobs')");
    expect(verifierHtml).toContain("goShell('/intake')");
    expect(verifierHtml).toContain("atmosphere: 'navigate'");
  });

  it('opens a Dashboard job name as the job profile', () => {
    expect(verifierHtml).toContain("var to = '/jobs/' + encodeURIComponent(id);");
    expect(verifierHtml).not.toContain("var to = '/jobs?job=' + encodeURIComponent(id);");
    expect(verifierHtml).not.toContain("var to = '/job-progress?job=' + encodeURIComponent(id);");
  });

  it('keeps the Videos filters on every office page, not only Dashboard', () => {
    expect(verifierHtml).toContain('id="evidence-nav"');
    expect(verifierHtml).toMatch(/<h3>Videos<\/h3>/);
    expect(verifierHtml).not.toMatch(/body\[data-atm-rail-only\]\s+#evidence-nav\s*\{[^}]*display:\s*none/);
    expect(verifierHtml).toContain(
      "window.parent.postMessage({ atmosphere: 'navigate', to: '/verifier-library' }, '*');",
    );
  });
});
