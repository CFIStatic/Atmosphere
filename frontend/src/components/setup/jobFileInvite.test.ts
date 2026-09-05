import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const verifierHtml = readFileSync(resolve(here, '../../../../verifier/index.html'), 'utf8');

const JOB_ID = 'job-9';
const INVITE_EMAIL = 'cygania5@uwm.edu';
const CAPTURE_URL =
  'https://platform.atmosphereteam.com/fieldcapture/index.html?token=3712efd6e32e480f50a849dea104077fb734bec7b3582c3b';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function bootOrgVerifier(fetchImpl: typeof fetch) {
  return new JSDOM(verifierHtml, {
    url: 'https://atmosphere.test/verifier/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = fetchImpl;
      window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return false;
        },
      })) as unknown as typeof window.matchMedia;
    },
  });
}

async function waitFor(document: Document, selector: string) {
  for (let i = 0; i < 40; i += 1) {
    const el = document.querySelector(selector);
    if (el) return el;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${selector} never rendered`);
}

describe('Dashboard job-file add people', () => {
  it('confirms the emailed invite without showing the Field Capture URL', () => {
    const paintInvite = verifierHtml.match(
      /if \(jobSheet\.tab === 'invite'\) \{[\s\S]*?return;\n    \}/,
    );
    expect(paintInvite).not.toBeNull();
    expect(paintInvite![0]).toContain('class="jf-made"');
    expect(paintInvite![0]).toContain('esc(jobSheet.made.note)');
    expect(paintInvite![0]).toContain('jobSheet.made.path');
    expect(paintInvite![0]).toContain('<code>');
    expect(paintInvite![0]).not.toContain('fieldCapturePath');

    expect(verifierHtml).toContain('.jf-made code');
    expect(verifierHtml).toContain('Copy the Field Capture link below');
  });

  it('does not attach a capture link to the invite success state', () => {
    const submitInvite = verifierHtml.match(/function submitInvite\(form\) \{[\s\S]*?\n  \}/);
    expect(submitInvite).not.toBeNull();
    expect(submitInvite![0]).toContain('Invite emailed to ');
    expect(submitInvite![0]).toContain('The same link opens on the web office and Field Capture.');
    expect(submitInvite![0]).toContain('Copy the Field Capture link below');
    expect(submitInvite![0]).not.toContain('Try again.');
    expect(submitInvite![0]).toContain('res.body.emailed');
    expect(submitInvite![0]).toContain('path:');
    expect(submitInvite![0]).toContain('fieldCapturePath');
    expect(submitInvite![0]).toContain('sharePath');
  });

  it('keeps the emailed note and hides the token URL after Email invite', async () => {
    const parties: unknown[] = [];
    const jobRecord = {
      job: { id: JOB_ID, title: 'Mobil test one 1111', number: 9 },
      parties: [
        { id: 'p-fc', company: 'Field Capture', role: 'field_capture', email: 'jack@jettx.ai' },
      ],
    };
    const dom = bootOrgVerifier(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return jsonResponse({
          user: { name: 'Jack Smith', email: 'jack@jettx.ai', orgName: 'Jettx LLC' },
        });
      }
      if (url.includes('/api/evidence-portal/library')) {
        return jsonResponse({
          jobs: [{ jobId: JOB_ID, jobName: 'Mobil test one 1111', jobNumber: 9 }],
          items: [],
        });
      }
      if (url.includes(`/api/operations/shared/${JOB_ID}/parties`) && init?.method === 'POST') {
        parties.push(JSON.parse(String(init.body || '{}')));
        jobRecord.parties = jobRecord.parties.concat([
          {
            id: 'p-jack',
            company: 'Jack Smith',
            role: 'subcontractor',
            trade: 'drywall',
            email: INVITE_EMAIL,
          },
        ]);
        return jsonResponse({
          emailed: true,
          fieldCapturePath: CAPTURE_URL,
          sharePath: '/shared/tok-demo',
        });
      }
      if (url.includes(`/api/operations/shared/${JOB_ID}/proof`)) {
        return jsonResponse({ days: [], counts: { days: 0 } });
      }
      if (url.includes(`/api/operations/shared/${JOB_ID}`)) {
        return jsonResponse(jobRecord);
      }
      if (url.includes('/api/evidence-portal/shares')) {
        return jsonResponse({ shares: [] });
      }
      return jsonResponse({});
    }) as typeof fetch);

    const { document } = dom.window;
    await waitFor(document, `tr.jobrow[data-job="${JOB_ID}"]`);
    const inviteBtn = document.querySelector(
      `tr.jobrow[data-job="${JOB_ID}"] [data-job-act="invite"]`,
    ) as HTMLButtonElement | null;
    expect(inviteBtn).not.toBeNull();
    inviteBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 80));
    const form = (await waitFor(document, '#jf-invite-form')) as HTMLFormElement;
    const company = document.querySelector(
      '#jf-invite-form input[name="company"]',
    ) as HTMLInputElement;
    const kind = document.querySelector('#jf-invite-form select[name="kind"]') as HTMLSelectElement;
    const email = document.querySelector('#jf-invite-form input[name="email"]') as HTMLInputElement;
    company.value = 'Jack Smith';
    kind.value = 'trade:drywall';
    email.value = INVITE_EMAIL;
    // jsdom does not expose named controls as form.company the way a browser does.
    Object.defineProperties(form, {
      company: { configurable: true, get: () => company },
      kind: { configurable: true, get: () => kind },
      email: { configurable: true, get: () => email },
    });
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

    for (let i = 0; i < 40; i += 1) {
      if (document.querySelector('.jf-made')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(parties).toHaveLength(1);
    const made = document.querySelector('.jf-made');
    expect(made?.textContent).toContain(`Invite emailed to ${INVITE_EMAIL}`);
    expect(made?.textContent).toContain('The same link opens on the web office and Field Capture.');
    expect(made?.textContent).not.toMatch(/fieldcapture\/index\.html\?token=/);
    expect(made?.querySelector('code')).toBeNull();
    expect(document.body.textContent).not.toContain(CAPTURE_URL);

    dom.window.close();
  });

  it('shows the Field Capture link when the invite email does not send', async () => {
    const parties: unknown[] = [];
    const jobRecord = {
      job: { id: JOB_ID, title: 'Mobil test one 1111', number: 9 },
      parties: [
        { id: 'p-fc', company: 'Field Capture', role: 'field_capture', email: 'jack@jettx.ai' },
      ],
    };
    const dom = bootOrgVerifier(((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/auth/me')) {
        return jsonResponse({
          user: { name: 'Jack Smith', email: 'jack@jettx.ai', orgName: 'Jettx LLC' },
        });
      }
      if (url.includes('/api/evidence-portal/library')) {
        return jsonResponse({
          jobs: [{ jobId: JOB_ID, jobName: 'Mobil test one 1111', jobNumber: 9 }],
          items: [],
        });
      }
      if (url.includes(`/api/operations/shared/${JOB_ID}/parties`) && init?.method === 'POST') {
        parties.push(JSON.parse(String(init.body || '{}')));
        jobRecord.parties = jobRecord.parties.concat([
          {
            id: 'p-jack',
            company: 'Jack Smith',
            role: 'subcontractor',
            trade: 'drywall',
            email: INVITE_EMAIL,
          },
        ]);
        return jsonResponse({
          emailed: false,
          fieldCapturePath: CAPTURE_URL,
          sharePath: '/shared/tok-demo',
        });
      }
      if (url.includes(`/api/operations/shared/${JOB_ID}/proof`)) {
        return jsonResponse({ days: [], counts: { days: 0 } });
      }
      if (url.includes(`/api/operations/shared/${JOB_ID}`)) {
        return jsonResponse(jobRecord);
      }
      if (url.includes('/api/evidence-portal/shares')) {
        return jsonResponse({ shares: [] });
      }
      return jsonResponse({});
    }) as typeof fetch);

    const { document } = dom.window;
    await waitFor(document, `tr.jobrow[data-job="${JOB_ID}"]`);
    const inviteBtn = document.querySelector(
      `tr.jobrow[data-job="${JOB_ID}"] [data-job-act="invite"]`,
    ) as HTMLButtonElement | null;
    expect(inviteBtn).not.toBeNull();
    inviteBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 80));
    const form = (await waitFor(document, '#jf-invite-form')) as HTMLFormElement;
    const company = document.querySelector(
      '#jf-invite-form input[name="company"]',
    ) as HTMLInputElement;
    const kind = document.querySelector('#jf-invite-form select[name="kind"]') as HTMLSelectElement;
    const email = document.querySelector('#jf-invite-form input[name="email"]') as HTMLInputElement;
    company.value = 'Jack Smith';
    kind.value = 'trade:drywall';
    email.value = INVITE_EMAIL;
    Object.defineProperties(form, {
      company: { configurable: true, get: () => company },
      kind: { configurable: true, get: () => kind },
      email: { configurable: true, get: () => email },
    });
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));

    for (let i = 0; i < 40; i += 1) {
      if (document.querySelector('.jf-made code')) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(parties).toHaveLength(1);
    const made = document.querySelector('.jf-made');
    expect(made?.textContent).toContain('Copy the Field Capture link below');
    expect(made?.textContent).not.toContain('Try again.');
    expect(made?.querySelector('code')?.textContent).toBe(CAPTURE_URL);

    dom.window.close();
  });
});
