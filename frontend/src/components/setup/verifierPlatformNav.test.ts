import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('verifier Dashboard rail', () => {
  it('lists Field above Start a job and Jobs under Dashboard', () => {
    const nav = verifierHtml.match(/<div class="rail-section" id="platform-nav"[\s\S]*?<\/div>/);
    expect(nav).not.toBeNull();
    const labels = [...nav![0].matchAll(/<span class="label">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Field', 'Start a job', 'Dashboard', 'Jobs']);
    expect(nav![0]).toContain('data-route="/field"');
    expect(nav![0]).toContain('data-route="/jobs"');
    expect(nav![0].indexOf('id="nav-field"')).toBeLessThan(nav![0].indexOf('id="nav-start-job"'));
    expect(nav![0].indexOf('data-screen="dashboard"')).toBeLessThan(nav![0].indexOf('id="nav-jobs"'));
  });

  it('hands Field and Jobs to the office shell', () => {
    expect(verifierHtml).toContain("goShell('/field')");
    expect(verifierHtml).toContain("goShell('/jobs')");
    expect(verifierHtml).toContain("atmosphere: 'navigate'");
  });
});
