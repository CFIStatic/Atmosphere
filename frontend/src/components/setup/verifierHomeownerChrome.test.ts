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
    for (const id of ['#nav-start-job', '#nav-logins', '#nav-suggested-work', '#nav-settings', '#menu-settings']) {
      expect(selectors).toContain(`body[data-atm-viewer] ${id}`);
    }
  });
});

describe('Sub whose own workspace never finished checkout', () => {
  it('gets a Start your plan rail item that opens the corporate pricing page, hidden by default', () => {
    expect(verifierHtml).toContain('id="nav-start-plan" hidden');
    expect(verifierHtml).toContain('#nav-start-plan[hidden] { display: none !important; }');
    expect(verifierHtml).toContain("var PRICING_URL = 'https://atmosphereteam.com/pricing';");
    expect(verifierHtml).toContain("window.open(PRICING_URL, '_blank', 'noopener');");
    expect(verifierHtml).toContain('setUpgrade(d.upgrade);');
  });
});

describe('Jobs shared with someone who has a workspace', () => {
  it('list on the Dashboard and play in the same clip player as the contractor', () => {
    expect(verifierHtml).toContain('sharedWithMe: Boolean(raw.sharedWithMe)');
    expect(verifierHtml).toContain('sharedWithMe: Boolean(j.sharedWithMe)');
    expect(verifierHtml).not.toContain('openJobRecord(item.job); return; }');
    expect(verifierHtml).toContain('tr.is-shared .job-acts');
    expect(verifierHtml).not.toContain('tr.is-shared .kebab');
    expect(verifierHtml).not.toContain('body[data-atm-viewer] tr.cliprow .kebab');
  });

  it('keeps Rename and Share on a shared clip with the contractor', () => {
    expect(verifierHtml).toContain('var guestClip = VIEWER || !!(clip && clip.sharedWithMe);');
    expect(verifierHtml).toContain('[data-act="rename"], [data-act="share"]');
  });

  it('mark another company\'s job "Shared by <company>"', () => {
    expect(verifierHtml).toContain("(job.sharedWithMe ? 'Shared by ' : '') + esc(job.company)");
  });
});
