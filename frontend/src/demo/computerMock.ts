/**
 * Demo (VITE_DEMO=1) stand-in for /api/chat-computer. Two scripted tasks on a fake
 * carrier portal: a claim form that fills itself in and then waits for
 * approval, and a permit site that stops for a verification code. All data
 * here is synthetic TEST DATA; no real browser is involved.
 */
import type { ComputerLogin, ComputerSignIn, ComputerTaskView } from '../lib/computer';

type Scenario = 'claim' | 'permit' | 'httpbin';

interface DemoTask {
  id: string;
  scenario: Scenario;
  instructions: string;
  createdAt: number;
  approvedAt: number | null;
  resumedAt: number | null;
  canceledAt: number | null;
  control: boolean;
}

const tasks = new Map<string, DemoTask>();

const IDS: Record<Scenario, string> = {
  claim: 'c0de0000-0000-4000-8000-00000000c001',
  permit: 'c0de0000-0000-4000-8000-00000000c002',
  httpbin: 'c0de0000-0000-4000-8000-00000000c003',
};

const RUN_MS: Record<Scenario, number> = { claim: 9_000, permit: 4_000, httpbin: 5_000 };

const FIELDS = [
  { label: 'Insured name', value: 'Dana Whitfield (TEST)', source: 'Job brief: Insured name', verified: true },
  { label: 'Claim number', value: 'CLM-TEST-48213', source: 'Job: Claim number', verified: true },
  { label: 'Policy number', value: 'POL-TEST-7731', source: 'Job: Policy number', verified: true },
  { label: 'Property address', value: '1842 Cedar Ridge Dr, Austin, TX', source: 'Job: Property address', verified: true },
  { label: 'Date of loss', value: '09/28/2026', source: 'Your message in Chat', verified: true },
  { label: 'Cause of loss', value: 'Hail', source: 'Not from the job or your message (check this)', verified: false },
];

function esc(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formPage(filled: number, opts: { title: string; host: string; twoFactor?: boolean }) {
  const rows = FIELDS.slice(0, 5)
    .map((f, i) => {
      const value = i < filled ? esc(f.value) : '';
      return `<label style="display:block;margin:0 0 14px"><span style="display:block;font-size:13px;color:#57534e;margin-bottom:4px">${esc(f.label)}</span><span style="display:block;height:34px;border:1px solid #d6d3d1;border-radius:6px;background:#fff;padding:7px 10px;font-size:15px;color:#1c1917;box-sizing:border-box">${value}</span></label>`;
    })
    .join('');
  const body = opts.twoFactor
    ? `<h1 style="font-size:24px;margin:0 0 8px">Verify it's you</h1><p style="color:#57534e;margin:0 0 18px">Enter the 6-digit verification code we sent to (512) 555-01XX.</p><span style="display:block;width:220px;height:40px;border:2px solid #2563eb;border-radius:6px;background:#fff"></span><span style="display:inline-block;margin-top:16px;background:#2563eb;color:#fff;border-radius:6px;padding:9px 18px">Verify</span>`
    : `<h1 style="font-size:24px;margin:0 0 6px">${esc(opts.title)}</h1><p style="color:#57534e;margin:0 0 18px">Fill out every field, then submit.</p>${rows}<div style="margin-top:18px"><span style="display:inline-block;border:1px solid #d6d3d1;border-radius:6px;padding:9px 18px;margin-right:10px">Save draft</span><span style="display:inline-block;background:#1d4ed8;color:#fff;border-radius:6px;padding:9px 18px">Submit claim</span></div>`;
  return `<!doctype html><html><body style="margin:0;font-family:system-ui,sans-serif;background:#f5f5f4;color:#1c1917"><div style="background:#1e3a8a;color:#fff;padding:12px 24px;font-weight:600">${esc(opts.host)} <span style="float:right;font-size:12px;background:#facc15;color:#1c1917;border-radius:4px;padding:2px 8px">TEST DATA · mock browser</span></div><div style="max-width:620px;margin:28px auto;background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:28px 32px">${body}</div></body></html>`;
}

function svgShot(filled: number) {
  const rows = FIELDS.slice(0, 5)
    .map((f, i) => {
      const y = 170 + i * 92;
      const value = i < filled ? esc(f.value) : '';
      return `<text x="340" y="${y}" font-size="20" fill="#57534e">${esc(f.label)}</text><rect x="340" y="${y + 12}" width="600" height="46" rx="6" fill="#fff" stroke="#d6d3d1"/><text x="356" y="${y + 43}" font-size="22" fill="#1c1917">${value}</text>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800" font-family="system-ui,sans-serif"><rect width="1280" height="800" fill="#f5f5f4"/><rect width="1280" height="56" fill="#1e3a8a"/><text x="24" y="36" font-size="20" fill="#fff" font-weight="600">portal.example-carrier.test</text><rect x="1040" y="16" width="216" height="26" rx="4" fill="#facc15"/><text x="1052" y="35" font-size="15" fill="#1c1917">TEST DATA · mock</text><rect x="300" y="80" width="680" height="690" rx="12" fill="#fff" stroke="#e7e5e4"/><text x="340" y="130" font-size="30" font-weight="600" fill="#1c1917">New property claim</text>${rows}<rect x="340" y="650" width="150" height="48" rx="6" fill="#fff" stroke="#d6d3d1"/><text x="372" y="681" font-size="20" fill="#1c1917">Save draft</text><rect x="510" y="650" width="190" height="48" rx="6" fill="#1d4ed8" stroke="#f59e0b" stroke-width="4"/><text x="540" y="681" font-size="20" fill="#fff">Submit claim</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function scenarioFor(question: string): Scenario | 'not_set_up' | null {
  const q = question.toLowerCase();
  if (!/\b(fill|complete|submit|file|apply|register|enter|update|request)\b/.test(q)) return null;
  if (!/(portal|website|web form|online|\.com|\.gov|\.org|\.net|\.test|https?:\/\/)/.test(q)) return null;
  if (q.includes('not set up')) return 'not_set_up';
  if (q.includes('httpbin')) return 'httpbin';
  if (/permit|city|county/.test(q)) return 'permit';
  return 'claim';
}

/** Chat answer for a browser task, or null when the question is not one. */
export function demoComputerAnswer(question: string): string | null {
  const scenario = scenarioFor(question);
  if (!scenario) return null;
  if (scenario === 'not_set_up') {
    return "I can't work in a browser for you yet.\n\n⟦actions: start_computer_task|Computer isn't set up yet|computer|computer-task:not-set-up⟧";
  }
  const id = IDS[scenario];
  tasks.set(id, {
    id,
    scenario,
    instructions: question,
    createdAt: Date.now(),
    approvedAt: null,
    resumedAt: null,
    canceledAt: null,
    control: false,
  });
  return `Opening a browser now, and I'll check with you before anything is submitted.\n\n⟦actions: start_computer_task|Started a browser task. It asks before anything is submitted.|computer|computer-task:${id}⟧`;
}

function view(t: DemoTask): ComputerTaskView {
  const now = Date.now();
  const elapsed = now - t.createdAt;
  const runMs = RUN_MS[t.scenario];
  let status: ComputerTaskView['status'] = 'running';
  let stepCount = Math.min(18, 2 + Math.floor(elapsed / 600));
  let statusDetail: string | null = null;
  let lastAction: string | null = t.scenario === 'httpbin' ? 'Typed in “Telephone”' : 'Typed in “Claim number”';
  let resultSummary: string | null = null;
  let result: ComputerTaskView['result'] = null;
  let submitted = false;
  let needsYou: ComputerTaskView['needsYou'] = null;
  let approval: ComputerTaskView['approval'] = null;
  let finishedAt: string | null = null;
  const host =
    t.scenario === 'claim' ? 'portal.example-carrier.test' : t.scenario === 'httpbin' ? 'httpbin.org' : 'permits.example-city.test';
  if (t.canceledAt) {
    status = 'canceled';
    resultSummary = 'Canceled. Nothing was submitted.';
    finishedAt = new Date(t.canceledAt).toISOString();
  } else if (t.scenario === 'claim') {
    if (t.approvedAt) {
      if (now - t.approvedAt > 3_000) {
        status = 'succeeded';
        stepCount = 21;
        submitted = true;
        resultSummary = 'Confirmation number TEST-55120.';
        result = {
          title: 'Claim submitted',
          fields: FIELDS.map(({ label, value }) => ({ label, value })),
          notes: resultSummary,
        };
        finishedAt = new Date(t.approvedAt + 3_000).toISOString();
      } else {
        stepCount = 20;
        lastAction = 'clicked the approved “Submit claim”';
      }
    } else if (elapsed >= runMs) {
      status = 'awaiting_approval';
      stepCount = 19;
      statusDetail = 'Waiting for your approval to click “Submit claim”.';
      approval = {
        id: 'c0de0000-0000-4000-8000-0000000ap001',
        status: 'pending',
        actionKind: 'submit',
        buttonLabel: 'Submit claim',
        summary: 'Submits the new property claim to the carrier with the details below.',
        pageUrl: 'https://portal.example-carrier.test/claims/new',
        fields: FIELDS,
        screenshot: svgShot(5),
        requestedAt: new Date(t.createdAt + runMs).toISOString(),
        expiresAt: new Date(t.createdAt + runMs + 10 * 60_000).toISOString(),
      };
    }
  } else if (t.scenario === 'httpbin') {
    if (elapsed >= runMs) {
      status = 'succeeded';
      resultSummary = 'No customer details on this job, so test values were used.';
      result = {
        title: 'Form filled',
        fields: [
          { label: 'Customer name', value: 'Test Customer' },
          { label: 'Telephone', value: '555-0100' },
          { label: 'E-mail address', value: 'test@example.com' },
        ],
        notes: resultSummary,
      };
      finishedAt = new Date(t.createdAt + runMs).toISOString();
    }
  } else if (t.resumedAt) {
    if (now - t.resumedAt > 3_000) {
      status = 'succeeded';
      stepCount = 14;
      resultSummary = 'Saved as a draft. Nothing was submitted.';
      result = {
        title: 'Draft saved',
        fields: [
          { label: 'Applicant', value: 'Dana Whitfield (TEST)' },
          { label: 'Site address', value: '1842 Cedar Ridge Dr, Austin, TX' },
          { label: 'Work type', value: 'Roof replacement' },
        ],
        notes: resultSummary,
      };
      finishedAt = new Date(t.resumedAt + 3_000).toISOString();
    }
  } else if (elapsed >= runMs) {
    status = 'needs_you';
    stepCount = 6;
    statusDetail = 'The site is asking for a verification code.';
    needsYou = {
      reason: 'two_factor',
      message: 'The permit site sent a verification code to your phone. Take control, enter it, then press Resume.',
      since: new Date(t.createdAt + runMs).toISOString(),
    };
  }
  const active = ['running', 'awaiting_approval', 'needs_you'].includes(status);
  const at = (ms: number) => new Date(t.createdAt + ms).toISOString();
  // The httpbin run replays the real task's audit trail (172a749a), timed for the demo.
  const httpbinEvents: ComputerTaskView['events'] = [
    { id: 1, event: 'task_queued', actor: 'user', at: at(0), detail: {} },
    { id: 2, event: 'task_started', actor: 'system', at: at(200), detail: {} },
    { id: 3, event: 'context_created', actor: 'system', at: at(300), detail: {} },
    { id: 4, event: 'session_started', actor: 'system', at: at(400), detail: {} },
    { id: 5, event: 'navigate', actor: 'agent', at: at(900), detail: { host: 'httpbin.org' } },
    { id: 6, event: 'action', actor: 'agent', at: at(1500), detail: { action: 'left_click', target: { tag: 'input', label: 'Customer name:' } } },
    { id: 7, event: 'action', actor: 'agent', at: at(1700), detail: { action: 'type', field: 'Customer name:', chars: 13 } },
    { id: 8, event: 'action', actor: 'agent', at: at(2300), detail: { action: 'left_click', target: { tag: 'input', label: 'Telephone:' } } },
    { id: 9, event: 'action', actor: 'agent', at: at(2500), detail: { action: 'type', field: 'Telephone:', chars: 8 } },
    { id: 10, event: 'action', actor: 'agent', at: at(3100), detail: { action: 'left_click', target: { tag: 'input', label: 'E-mail address:' } } },
    { id: 11, event: 'action', actor: 'agent', at: at(3300), detail: { action: 'type', field: 'E-mail address:', chars: 16 } },
    { id: 12, event: 'finished', actor: 'agent', at: at(runMs), detail: { submitted: false } },
    { id: 13, event: 'session_ended', actor: 'system', at: at(runMs), detail: {} },
    { id: 14, event: 'task_finished', actor: 'system', at: at(runMs), detail: { status: 'succeeded', submitted: false } },
  ].filter((e) => Date.parse(e.at) <= now);
  const events: ComputerTaskView['events'] = t.scenario === 'httpbin' ? httpbinEvents : [
    { id: 1, event: 'task_queued', actor: 'user', at: new Date(t.createdAt).toISOString(), detail: {} },
    { id: 2, event: 'session_started', actor: 'system', at: new Date(t.createdAt + 400).toISOString(), detail: {} },
    { id: 3, event: 'navigate', actor: 'agent', at: new Date(t.createdAt + 900).toISOString(), detail: { host } },
    { id: 4, event: 'action', actor: 'agent', at: new Date(t.createdAt + 1500).toISOString(), detail: { action: 'type', field: 'Insured name' } },
    { id: 5, event: 'action', actor: 'agent', at: new Date(t.createdAt + 2200).toISOString(), detail: { action: 'type', field: 'Claim number' } },
  ];
  if (status === 'awaiting_approval') {
    events.push({ id: 6, event: 'approval_requested', actor: 'agent', at: new Date(t.createdAt + runMs).toISOString(), detail: { label: 'Submit claim' } });
  }
  if (status === 'needs_you') {
    events.push({ id: 6, event: 'needs_you', actor: 'agent', at: new Date(t.createdAt + runMs).toISOString(), detail: { reason: 'two_factor' } });
  }
  return {
    id: t.id,
    jobId: null,
    status,
    statusDetail,
    instructions: t.instructions,
    startUrl: `https://${host}/`,
    needsYou,
    humanControl: t.control,
    youHaveControl: t.control,
    stepCount,
    maxSteps: 60,
    lastAction,
    currentUrl: `https://${host}/${t.scenario === 'claim' ? 'claims/new' : t.scenario === 'httpbin' ? 'forms/post' : 'verify'}`,
    resultSummary,
    result,
    submitted,
    error: null,
    createdAt: new Date(t.createdAt).toISOString(),
    startedAt: new Date(t.createdAt + 300).toISOString(),
    finishedAt,
    canWatch: active,
    jobFields: FIELDS.slice(0, 4).map(({ label, value, source }) => ({ label, value, source })),
    approval,
    events,
  };
}

function liveHtml(t: DemoTask) {
  const v = view(t);
  const filled = Math.min(5, Math.max(1, Math.floor((Date.now() - t.createdAt) / 1600)));
  const html =
    t.scenario === 'permit' && v.status === 'needs_you'
      ? formPage(0, { title: '', host: 'permits.example-city.test', twoFactor: true })
      : formPage(v.status === 'awaiting_approval' ? 5 : filled, {
          title: t.scenario === 'claim' ? 'New property claim' : t.scenario === 'httpbin' ? 'Pizza order (httpbin test form)' : 'Roofing permit application',
          host: t.scenario === 'claim' ? 'portal.example-carrier.test' : t.scenario === 'httpbin' ? 'httpbin.org' : 'permits.example-city.test',
        });
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

type Handler = (m: RegExpMatchArray, b: Record<string, unknown>) => { status?: number; body: unknown };

function find(id: string) {
  return tasks.get(id) ?? null;
}

const notFound = { status: 404, body: { error: 'Task not found', code: 'not_found' } };

export const computerDemoRoutes: Array<[string, RegExp, Handler]> = [
  ['GET', /^\/api\/chat-computer\/status$/, () => ({ body: { configured: true, provider: 'mock', message: null } })],
  ['GET', /^\/api\/chat-computer\/tasks\/([\w-]+)$/, (m) => {
    const t = find(m[1]);
    return t ? { body: { task: view(t) } } : notFound;
  }],
  ['POST', /^\/api\/chat-computer\/tasks\/([\w-]+)\/live$/, (m, b) => {
    const t = find(m[1]);
    if (!t) return notFound;
    const mode = b.mode === 'control' ? 'control' : 'watch';
    if (mode === 'control') t.control = true;
    return { body: { url: liveHtml(t), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), mode } };
  }],
  ['POST', /^\/api\/chat-computer\/tasks\/([\w-]+)\/hand-back$/, (m) => {
    const t = find(m[1]);
    if (!t) return notFound;
    t.control = false;
    return { body: { ok: true } };
  }],
  ['POST', /^\/api\/chat-computer\/tasks\/([\w-]+)\/resume$/, (m) => {
    const t = find(m[1]);
    if (!t) return notFound;
    t.resumedAt = Date.now();
    t.control = false;
    return { body: { ok: true } };
  }],
  ['POST', /^\/api\/chat-computer\/tasks\/([\w-]+)\/cancel$/, (m) => {
    const t = find(m[1]);
    if (!t) return notFound;
    t.canceledAt = Date.now();
    return { body: { ok: true } };
  }],
  ['POST', /^\/api\/chat-computer\/approvals\/([\w-]+)\/approve$/, () => {
    const t = find(IDS.claim);
    if (!t) return notFound;
    t.approvedAt = Date.now();
    return { body: { ok: true } };
  }],
  ['POST', /^\/api\/chat-computer\/approvals\/([\w-]+)\/cancel$/, () => {
    const t = find(IDS.claim);
    if (!t) return notFound;
    t.canceledAt = Date.now();
    return { body: { ok: true } };
  }],
];

// ---- Logins (demo): a list kept in memory and a fake sign-in page ----

const demoLogins: ComputerLogin[] = [];
let demoSignIn: ComputerSignIn | null = null;

function demoSignInPage(host: string) {
  const html = `<!doctype html><html><body style="margin:0;font-family:Segoe UI,Arial,sans-serif;background:#f3f3f3;display:grid;place-items:center;height:100vh">
<div style="background:#fff;width:440px;padding:44px;box-shadow:0 2px 6px rgba(0,0,0,.2)">
<div style="font-size:13px;color:#666">${host}</div>
<h1 style="font-size:24px;font-weight:600;margin:12px 0 16px">Sign in</h1>
<input placeholder="Email, phone, or Skype" style="width:100%;border:0;border-bottom:1px solid #666;padding:8px 0;font-size:15px">
<div style="text-align:right;margin-top:28px"><button style="background:#0067b8;color:#fff;border:0;padding:8px 32px;font-size:15px">Next</button></div>
<p style="font-size:11px;color:#999;margin-top:24px">TEST DATA: demo sign-in page</p></div></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function demoLiveUrl(host: string): string {
  const injected = (globalThis as { __DEMO_LIVE_URL?: string }).__DEMO_LIVE_URL;
  return typeof injected === 'string' && injected ? injected : demoSignInPage(host);
}

function demoHost(raw: string): { url: string; host: string } | null {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return { url: u.toString(), host: u.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

computerDemoRoutes.push(
  ['GET', /^\/api\/chat-computer\/logins$/, () => ({
    body: { configured: true, message: null, logins: demoLogins, signingIn: demoSignIn, busy: null },
  })],
  ['POST', /^\/api\/chat-computer\/logins\/sign-ins$/, (_m, b) => {
    if (demoSignIn) return { status: 409, body: { error: `Someone is signing in to ${demoSignIn.label} right now.`, code: 'busy' } };
    const existing = typeof b.loginId === 'string' ? demoLogins.find((l) => l.id === b.loginId) : undefined;
    const target = existing ? { url: existing.url, host: existing.host } : demoHost(String(b.url ?? ''));
    if (!target) return { status: 400, body: { error: 'Enter a web address like https://portal.example.com.', code: 'bad_url' } };
    const now = Date.now();
    demoSignIn = {
      sessionId: `d0e00000-0000-4000-8000-${String(now).slice(-12).padStart(12, '0')}`,
      label: existing?.label ?? (String(b.label ?? '').trim() || target.host),
      url: target.url,
      host: target.host,
      loginId: existing?.id ?? null,
      startedAt: new Date(now).toISOString(),
      startedBy: 'Dana Ruiz',
      startedByYou: true,
      expiresAt: new Date(now + 15 * 60_000).toISOString(),
    };
    return { body: { signIn: demoSignIn } };
  }],
  ['POST', /^\/api\/chat-computer\/logins\/sign-ins\/([\w-]+)\/live$/, (m) => {
    if (!demoSignIn || demoSignIn.sessionId !== m[1]) return notFound;
    return { body: { url: demoLiveUrl(demoSignIn.host), expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(), mode: 'control' } };
  }],
  ['POST', /^\/api\/chat-computer\/logins\/sign-ins\/([\w-]+)\/done$/, (m) => {
    if (!demoSignIn || demoSignIn.sessionId !== m[1]) return notFound;
    const now = new Date().toISOString();
    let login = demoLogins.find((l) => l.host === demoSignIn!.host);
    if (login) {
      login.lastSignedInAt = now;
      login.lastSignedInBy = 'Dana Ruiz';
    } else {
      login = {
        id: `d0e10000-0000-4000-8000-${String(demoLogins.length + 1).padStart(12, '0')}`,
        label: demoSignIn.label,
        url: demoSignIn.url,
        host: demoSignIn.host,
        addedBy: 'Dana Ruiz',
        addedAt: now,
        lastSignedInAt: now,
        lastSignedInBy: 'Dana Ruiz',
        canClearCookies: true,
      };
      demoLogins.push(login);
    }
    demoSignIn = null;
    return { body: { login } };
  }],
  ['POST', /^\/api\/chat-computer\/logins\/sign-ins\/([\w-]+)\/cancel$/, () => {
    demoSignIn = null;
    return { body: { ok: true } };
  }],
  ['DELETE', /^\/api\/chat-computer\/logins\/([\w-]+)$/, (m) => {
    const i = demoLogins.findIndex((l) => l.id === m[1]);
    if (i < 0) return notFound;
    const [gone] = demoLogins.splice(i, 1);
    return { body: { removed: true, cookiesCleared: true, message: `Removed ${gone.label}. Computer is signed out of it.` } };
  }],
);
