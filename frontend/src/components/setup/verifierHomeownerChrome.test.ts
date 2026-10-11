import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');

describe('Invited homeowner chrome', () => {
  it('hides Start a job, Logins and Settings (rail and account menu)', () => {
    const rule = verifierHtml.slice(verifierHtml.indexOf('body[data-atm-viewer] #nav-start-job'));
    const selectors = rule.slice(0, rule.indexOf('{'));
    for (const id of ['#nav-start-job', '#nav-logins', '#nav-settings', '#menu-settings']) {
      expect(selectors).toContain(`body[data-atm-viewer] ${id}`);
    }
  });
});
