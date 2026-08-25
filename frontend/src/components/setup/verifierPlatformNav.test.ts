import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const verifierHtml = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../../verifier/index.html'),
  'utf8',
);

describe('verifier Overview rail', () => {
  it('lists Overview first, then Start a job, Field, and My jobs', () => {
    const nav = verifierHtml.match(/<div class="rail-section" id="platform-nav"[\s\S]*?<\/div>/);
    expect(nav).not.toBeNull();
    const labels = [...nav![0].matchAll(/<span class="label">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Overview', 'Start a job', 'Field', 'My jobs']);
    expect(nav![0]).toContain('data-screen="dashboard"');
    expect(nav![0]).toContain('data-route="/field"');
    expect(nav![0]).toContain('data-route="/jobs"');
    expect(nav![0]).not.toContain('>Dashboard<');
  });

  it('enlarges both the five-bar mark and the Atmosphere word', () => {
    expect(verifierHtml).toMatch(/\.brand\s*\{[^}]*font-size:\s*22px/);
    expect(verifierHtml).toMatch(/\.rail-head \.brand\s*\{\s*font-size:\s*22px/);
    expect(verifierHtml).toMatch(/\.brand svg\s*\{[^}]*width:\s*32px/);
    expect(verifierHtml).toContain('width="32" height="32"');
    expect(verifierHtml).toMatch(/--rail-w:\s*248px/);
  });

  it('hands Field and My jobs to the office shell', () => {
    expect(verifierHtml).toContain("goShell('/field')");
    expect(verifierHtml).toContain("goShell('/jobs')");
    expect(verifierHtml).toContain("atmosphere: 'navigate'");
  });

  it('keeps the Videos filters on the library rail', () => {
    expect(verifierHtml).toContain('data-label="All videos"');
    expect(verifierHtml).toContain('data-label="Classified"');
    expect(verifierHtml).toContain('data-label="Awaiting analysis"');
    expect(verifierHtml).toContain('data-label="Needs review"');
    expect(verifierHtml).toContain('data-label="Legal hold"');
  });
});
