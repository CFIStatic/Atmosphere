import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const OUT = process.env.SMOKE_OUT ?? '/workspace/job-section-bar-shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ??
    '/home/box/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
});

const json = (b, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(b),
});

const TERMS = {
  required: false,
  currentVersion: '2026-09-10',
  acceptedVersion: '2026-09-10',
  acceptedAt: '2026-09-10T12:00:00Z',
  url: 'https://atmosphereteam.com/terms',
};

const jobId = 'job-tiffany';
const record = {
  job: {
    id: jobId,
    jobNumber: 2044,
    title: 'Project Tiffany & Co.',
    status: 'in_progress',
    claimNumber: null,
  },
  brief: null,
  revisions: [],
  currentRevision: 1,
  parties: [],
  scope: [],
  money: { approved: 0, pending: 0, unpricedApprovals: 0 },
  messages: [],
  risks: [],
  access: 'org',
};

const proofs = {
  days: [
    {
      partyId: 'pty-fc',
      company: 'Field Capture',
      workDate: '2026-09-17',
      hasBefore: true,
      hasAfter: true,
      checks: [],
      contradicted: false,
      summary: 'Day film on file. The assistant describes the work from this clip.',
      payable: false,
      payableBecause: null,
      accepted: false,
      rejected: false,
      aiSummary: null,
      aiFindings: null,
      proofIds: ['pf-1'],
    },
  ],
  videos: [],
  counts: { days: 1, videos: 0, payable: 0, contradicted: 0, awaitingAfter: 0 },
  siteKnown: true,
};

const askThreads = [{ id: 'th-1', title: 'Chat', createdAt: '2026-09-18T12:00:00Z', updatedAt: '2026-09-18T12:00:00Z' }];
let askQuestions = [];
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

await page.addInitScript(() => {
  localStorage.setItem('atmosphere.theme', 'dark');
  sessionStorage.setItem('atmosphere.termsAckVersion', '2026-09-10');
});

await page.route('**/api/**', async (route) => {
  const path = route.request().url().replace(/^https?:\/\/[^/]+/, '');

  if (path === '/api/auth/me') {
    return route.fulfill(
      json({
        user: {
          id: 'u-1',
          email: 'dana@atmosphere.test',
          createdAt: new Date().toISOString(),
          lastSignInAt: null,
          emailConfirmed: true,
          metadata: {},
        },
        terms: TERMS,
      }),
    );
  }
  if (path === '/api/org/me') {
    return route.fulfill(
      json({
        membership: {
          role: 'project_manager',
          workType: 'mitigation',
          status: 'active',
          org: { id: 'o-1', name: 'Lone Star Restoration', joinCode: 'LSR7742' },
        },
      }),
    );
  }
  if (path === '/api/auth/pin/status') return route.fulfill(json({ enrolled: false }));
  if (path === '/api/org/members') return route.fulfill(json({ members: [] }));
  if (path === '/api/profile') {
    return route.fulfill(
      json({
        profile: {
          id: 'u-1',
          email: 'dana@atmosphere.test',
          fullName: 'Dana Ortiz',
          avatarUrl: null,
        },
      }),
    );
  }
  if (path === '/api/operations/shared') {
    return route.fulfill(
      json({
        jobs: [
          {
            jobId,
            jobNumber: 2044,
            title: record.job.title,
            status: 'in_progress',
            parties: 0,
            currentRevision: 1,
            behind: 0,
            awaiting: 0,
            exclusions: 0,
          },
        ],
        counts: { jobs: 1, parties: 0, blockers: 0, awaiting: 0 },
      }),
    );
  }
  if (path === `/api/operations/shared/${jobId}`) {
    return route.fulfill(json(record));
  }
  if (path === `/api/operations/shared/${jobId}/proof`) {
    return route.fulfill(json(proofs));
  }
  if (path === `/api/operations/shared/${jobId}/access-roster`) {
    return route.fulfill(
      json({
        people: [
          {
            id: 'grant-1',
            kind: 'homeowner',
            name: 'Alex Homeowner',
            email: 'alex@example.com',
            accessType: 'Homeowner progress',
            role: 'homeowner',
            displayLabel: 'Homeowner',
            displayName: 'Alex Homeowner',
            grantedByName: 'Dana Ortiz',
            grantedByEmail: 'dana@atmosphere.test',
            grantedAt: '2026-09-12T12:00:00Z',
            lastAccessedAt: '2026-09-18T15:00:00Z',
            state: 'live',
          },
        ],
      }),
    );
  }
  if (path.includes('/threads')) {
    if (route.request().method() === 'POST') {
      return route.fulfill(json({ thread: askThreads[0] }));
    }
    return route.fulfill(json({ threads: askThreads }));
  }
  if (path.includes('/questions') || path.includes('/ask')) {
    return route.fulfill(json({ questions: askQuestions, threads: askThreads }));
  }
  if (path.includes('/evidence')) return route.fulfill(json({ items: [] }));
  if (path.includes('/claim') || path.includes('/packet') || path.includes('/proof-pack')) {
    return route.fulfill(json({ ready: false, items: [], packet: null }));
  }
  if (path.includes('/readiness')) return route.fulfill(json({ checks: [] }));
  if (path.includes('/scope') || path.includes('/documents')) {
    return route.fulfill(json({ documents: [], items: [] }));
  }
  if (path.includes('/live')) {
    return route.fulfill(
      json({
        sessions: [],
        latencyNote: '',
        privacyNote: '',
        pollIntervalSeconds: 5,
      }),
    );
  }
  if (path.includes('/today')) return route.fulfill(json({ clips: [], scope: [], asks: [] }));
  return route.fulfill(json({}));
});

async function shot(name) {
  await page.waitForTimeout(500);
  const dest = `${OUT}/${name}.png`;
  await page.screenshot({ path: dest, fullPage: false });
  console.log(dest);
}

await page.goto(
  `http://127.0.0.1:4173/job-progress?job=${jobId}&title=${encodeURIComponent(record.job.title)}`,
  { waitUntil: 'networkidle' },
);

const bodyPreview = (await page.locator('body').innerText()).slice(0, 300);
console.log('BODY_PREVIEW', bodyPreview.replace(/\n/g, ' | '));

await page.waitForSelector('[data-testid="job-file-section-bar"]', { timeout: 20000 });
await page.waitForSelector('[data-testid="job-happening-now"]', { timeout: 20000 });
// No persistent left Ask column on this page
const splitCount = await page.locator('[data-testid="job-file-ask-split"]').count();
const askBeside = await page.locator('[data-testid="job-file"][data-ask-placement="section"]').count();
console.log('askPlacementSection', askBeside, 'splitCount', splitCount);
await shot('01-happening-now');

await page.getByRole('tab', { name: 'Access' }).click();
await page.waitForSelector('[data-testid="job-access-roster"]');
await shot('02-access');

await page.getByRole('tab', { name: 'Videos' }).click();
await page.waitForTimeout(400);
await shot('03-videos');

await page.getByRole('tab', { name: 'Chat' }).click();
await page.waitForSelector('[data-testid="job-ask-panel"]');
await page.waitForSelector('[data-testid="job-file-ask"]');
await page.waitForSelector('textarea[placeholder="Ask what you forgot…"]');
// Empty state — composer must sit at bottom of chat panel / page content
await shot('04-chat-empty');

// With a couple of messages — same bottom composer
askQuestions = [
  {
    id: 'q-1',
    thread_id: 'th-1',
    question: 'What happened on this job?',
    answer: 'Crew filmed the Tiffany site on Thu, Sep 17. Day film is on file.',
    grounded_on: [],
    created_at: '2026-09-18T14:00:00Z',
    model: 'test',
  },
  {
    id: 'q-2',
    thread_id: 'th-1',
    question: 'Is anything still unfinished?',
    answer: 'Nothing flagged unfinished from the clips on file yet.',
    grounded_on: [],
    created_at: '2026-09-18T14:05:00Z',
    model: 'test',
  },
];
await page.goto(
  `http://127.0.0.1:4173/job-progress?job=${jobId}&ask=1&title=${encodeURIComponent(record.job.title)}`,
  { waitUntil: 'networkidle' },
);
await page.waitForSelector('[data-testid="job-ask-panel"]');
await page.waitForTimeout(800);
await shot('04-chat-messages');
// Keep legacy name pointing at empty bottom-bar shot for coordinator
await page.screenshot({ path: `${OUT}/04-chat.png`, fullPage: false });
console.log(`${OUT}/04-chat.png`);

await page.getByRole('tab', { name: 'Happening Now' }).click();
await page.waitForSelector('[data-testid="job-happening-now"]');
await page.locator('[data-testid="job-file"]').screenshot({
  path: `${OUT}/05-job-file-full.png`,
});
console.log(`${OUT}/05-job-file-full.png`);

await shot('06-happening-now-column');

console.log('page errors:', errors.length);
for (const e of errors) console.log(' !', e);
await browser.close();
