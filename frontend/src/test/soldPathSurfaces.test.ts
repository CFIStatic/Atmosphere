import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repo = resolve(root, '..');

function read(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8');
}

function readRepo(rel: string) {
  return readFileSync(resolve(repo, rel), 'utf8');
}

/**
 * Sold-path contract: dead products must not reappear on the office console
 * or in production dependencies. Backend HTTP 404s are covered by
 * backend/test/soldPathHttp.test.ts.
 */
describe('sold path — removed office surfaces stay gone', () => {
  it('does not mount /technician or ship the Technician page', () => {
    const app = read('src/App.tsx');
    expect(app).not.toContain('path="/technician"');
    expect(app).not.toContain('TechnicianPage');
    expect(() => read('src/pages/TechnicianPage.tsx')).toThrow();
  });

  it('does not depend on TF.js / coco-ssd in production dependencies', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@tensorflow/tfjs']).toBeUndefined();
    expect(pkg.dependencies['@tensorflow-models/coco-ssd']).toBeUndefined();
    expect(pkg.dependencies.playwright).toBeUndefined();
  });

  it('does not keep Playwright in backend production dependencies', () => {
    const pkg = JSON.parse(readRepo('backend/package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.playwright).toBeUndefined();
  });

  it('does not keep dead config keys for computer-use / estimator / prospecting / Salesforce', () => {
    const cfg = readRepo('backend/src/config.ts');
    expect(cfg).not.toMatch(/\bcomputerUse\s*:/);
    expect(cfg).not.toMatch(/\bestimator\s*:/);
    expect(cfg).not.toMatch(/\bprospecting\s*:/);
    expect(cfg).not.toMatch(/\bsalesforce\s*:/);
  });
});
