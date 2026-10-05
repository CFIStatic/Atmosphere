/**
 * Computer from Chat's side: the org-only start_computer_task tool, the
 * "not set up" state, the approval gate's classification rules, and the
 * allowlisted job projection.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyClick, classifyKey, classifyType, kindFromLabel } from '../src/computer/gate.js';
import { projectJobForComputer } from '../src/computer/projection.js';
import { MockComputerProvider } from '../src/computer/providers/mock.js';
import { setComputerProviderForTests } from '../src/computer/providers/index.js';
import { computerStatus } from '../src/computer/service.js';
import { MemoryComputerStore } from '../src/computer/store.js';
import { setComputerWorkerDepsForTests } from '../src/computer/worker.js';
import type { TargetDescriptor } from '../src/computer/types.js';
import {
  askToolsForAccess,
  executeAskTool,
  formatActionsTrailer,
  looksLikeComputerTask,
  parseActionsTrailer,
  pickAskToolsHeuristically,
  type AskToolContext,
} from '../src/shared/askTools.js';
import { classifyTokenFeature, TOKEN_FEATURE_LABELS, TOKEN_FEATURES } from '../src/metering/tokenFeatures.js';
import { featureLabel } from '../src/metering/aiBudget.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const JOB = '0d000000-0000-4000-8000-000000000004';
const USER = '0c000000-0000-4000-8000-000000000003';

function ctx(access: 'org' | 'viewer', userId: string | null = USER): AskToolContext {
  return {
    orgId: ORG,
    jobId: JOB,
    supabase: {} as unknown as SupabaseClient,
    access,
    userId,
    file: { job: { claimNumber: 'CLM-T-1' }, facts: { 'Gate code': '1111', Homeowner: 'Pat Test' } },
    address: '2 Test St',
  };
}

afterEach(() => {
  setComputerProviderForTests(null);
  setComputerWorkerDepsForTests(null);
});

const ASK = 'Fill out the claim form on portal.example-carrier.test for this job';

test('start_computer_task is office-only: viewers never get it', async () => {
  assert.ok(askToolsForAccess('org').some((t) => t.name === 'start_computer_task'));
  assert.ok(!askToolsForAccess('viewer').some((t) => t.name === 'start_computer_task'));
  assert.deepEqual(pickAskToolsHeuristically(ASK, 'org'), ['start_computer_task']);
  assert.ok(!pickAskToolsHeuristically(ASK, 'viewer').includes('start_computer_task'));

  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null });
  const viewer = await executeAskTool('start_computer_task', { instructions: ASK }, ctx('viewer'));
  assert.equal(viewer.ok, false);
  assert.match(viewer.summary, /only available to office users/);
  const anonymous = await executeAskTool('start_computer_task', { instructions: ASK }, ctx('org', null));
  assert.equal(anonymous.ok, false);
  assert.equal(store.tasks.size, 0, 'no task is queued for a non-org user');
});

test('the Chat tool queues a task and returns a task card', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null });
  await store.saveLogin({
    org_id: ORG,
    label: 'Carrier portal',
    url: 'https://portal.example-carrier.test/',
    host: 'portal.example-carrier.test',
    cookie_domains: [],
    user_id: USER,
    at: new Date().toISOString(),
  });
  const result = await executeAskTool('start_computer_task', { instructions: ASK }, ctx('org'));
  assert.equal(result.ok, true, result.summary);
  const [task] = [...store.tasks.values()];
  assert.equal(task.status, 'queued');
  assert.equal(task.org_id, ORG);
  assert.equal(task.job_id, JOB);
  assert.equal(task.start_url, 'https://portal.example-carrier.test/');
  assert.equal(task.model_id, 'claude-sonnet-5');
  assert.deepEqual(
    task.job_projection.map((f) => f.key).sort(),
    ['fact.homeowner', 'job.address', 'job.claimNumber'],
    'gate code is not projected',
  );
  const trailer = formatActionsTrailer([result]);
  const [action] = parseActionsTrailer(`answer\n\n${trailer}`);
  assert.equal(action.tool, 'start_computer_task');
  assert.equal(action.path, `computer-task:${task.id}`);
  assert.ok(store.audit.some((e) => e.event === 'task_queued' && e.actor_kind === 'user'));
});

test('a paused AI allowance refuses to start a task', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({
    store,
    admin: null,
    assertAiAllowed: async () => {
      throw new Error('AI is paused until the usage allowance resets.');
    },
  });
  await store.saveLogin({
    org_id: ORG,
    label: 'Carrier portal',
    url: 'https://portal.example-carrier.test/',
    host: 'portal.example-carrier.test',
    cookie_domains: [],
    user_id: USER,
    at: new Date().toISOString(),
  });
  const result = await executeAskTool('start_computer_task', { instructions: ASK }, ctx('org'));
  assert.equal(result.ok, false);
  assert.match(result.summary, /AI is paused/);
  assert.equal(store.tasks.size, 0);
});

test("without Browserbase keys Computer isn't set up, and Chat shows that card", async () => {
  delete process.env.BROWSERBASE_API_KEY;
  delete process.env.BROWSERBASE_PROJECT_ID;
  const store = new MemoryComputerStore();
  setComputerWorkerDepsForTests({ store, admin: null });
  await store.saveLogin({
    org_id: ORG,
    label: 'Carrier portal',
    url: 'https://portal.example-carrier.test/',
    host: 'portal.example-carrier.test',
    cookie_domains: [],
    user_id: USER,
    at: new Date().toISOString(),
  });
  const status = computerStatus();
  assert.equal(status.configured, false);
  assert.match(status.message ?? '', /Computer isn't set up/);
  const result = await executeAskTool('start_computer_task', { instructions: ASK }, ctx('org'));
  assert.equal(result.ok, false);
  assert.match(result.summary, /Computer isn't set up/);
  assert.equal(store.tasks.size, 0);
  const [action] = parseActionsTrailer(formatActionsTrailer([result]));
  assert.equal(action.path, 'computer-task:not-set-up', 'the not-set-up card still renders');
});

test('Browserbase is configured only with both variables', () => {
  process.env.BROWSERBASE_API_KEY = 'bb_test_placeholder';
  try {
    assert.equal(computerStatus().provider, 'browserbase');
    assert.equal(computerStatus().configured, false, 'project id still missing');
  } finally {
    delete process.env.BROWSERBASE_API_KEY;
  }
});

test('the computer-task heuristic needs an action and a website', () => {
  assert.equal(looksLikeComputerTask(ASK), true);
  assert.equal(looksLikeComputerTask('Go to https://permits.example.gov and fill out the roofing permit'), true);
  assert.equal(looksLikeComputerTask('use the browser to update the claim on the carrier portal'), true);
  assert.equal(looksLikeComputerTask('Did the crew submit photos to the portal?'), false);
  assert.equal(looksLikeComputerTask('Update the claim number to 123'), false);
  assert.equal(looksLikeComputerTask('Update the site address to 5 Main St'), false);
  assert.equal(looksLikeComputerTask('What is on the website?'), false);
});

const base: TargetDescriptor = {
  tag: 'button',
  type: 'submit',
  role: null,
  label: '',
  href: null,
  inForm: true,
  formAction: null,
  isFileInput: false,
  isPassword: false,
  isOneTimeCode: false,
  isCheckbox: false,
  isTextEntry: false,
  isTextarea: false,
  inCaptcha: false,
  frameSrc: null,
};
const t = (p: Partial<TargetDescriptor>): TargetDescriptor => ({ ...base, ...p });

test('gate: consequential clicks need approval; navigation does not', () => {
  const kind = (p: Partial<TargetDescriptor>) => {
    const d = classifyClick(t(p));
    return d.type === 'consequential' ? d.kind : d.type;
  };
  assert.equal(kind({ label: 'Submit claim' }), 'submit');
  assert.equal(kind({ label: 'Send message', type: 'button' }), 'send');
  assert.equal(kind({ label: 'Pay $250.00' }), 'pay');
  assert.equal(kind({ label: 'Place order' }), 'pay');
  assert.equal(kind({ label: 'Delete document', type: 'button' }), 'delete');
  assert.equal(kind({ label: 'Adopt and Sign' }), 'sign');
  assert.equal(kind({ label: 'I agree', type: 'button' }), 'accept_terms');
  assert.equal(kind({ tag: 'input', type: 'file', isFileInput: true, label: 'Photos' }), 'upload');
  assert.equal(kind({ tag: 'a', type: null, label: 'Upload documents', inForm: false }), 'upload');
  assert.equal(kind({ tag: 'input', type: 'checkbox', isCheckbox: true, label: 'I accept the Terms of Service' }), 'accept_terms');
  assert.equal(kind({ label: '' }), 'submit', 'an unlabeled submit button is gated');
  assert.equal(kind({ tag: 'div', type: null, label: 'Confirm', inForm: false }), 'submit', 'click handlers on divs count');

  assert.equal(kind({ label: 'Next' }), 'allow');
  assert.equal(kind({ label: 'Continue' }), 'allow');
  assert.equal(kind({ label: 'Sign in' }), 'allow');
  assert.equal(kind({ label: 'Save draft' }), 'allow');
  assert.equal(kind({ tag: 'input', type: 'text', isTextEntry: true, label: 'Claim number' }), 'allow');
  assert.equal(kind({ tag: 'input', type: 'checkbox', isCheckbox: true, label: 'Water damage' }), 'allow');
  assert.equal(kind({ tag: 'a', type: null, label: 'Claims', inForm: false }), 'allow');
  assert.equal(classifyClick(t({ tag: 'iframe', inCaptcha: true })).type, 'needs_you');
  assert.equal(kindFromLabel('Sign out'), null);
});

test('gate: Enter in a form field is a submit; passwords and codes are never typed', () => {
  const field = t({ tag: 'input', type: 'text', isTextEntry: true, label: 'Claim number' });
  assert.equal(classifyKey('Return', field).type, 'consequential');
  assert.equal(classifyKey('Tab', field).type, 'allow');
  assert.equal(classifyKey('Return', t({ tag: 'textarea', type: null, isTextEntry: true, isTextarea: true })).type, 'allow');
  assert.equal(classifyKey('ctrl+Return', t({ tag: 'textarea', type: null, isTextEntry: true, isTextarea: true })).type, 'consequential');
  assert.equal(classifyKey('Return', t({ label: 'Submit claim' })).type, 'consequential', 'Enter on a focused submit button');
  assert.equal(classifyType('abc\n', field).type, 'consequential');
  assert.equal(classifyType('abc', field).type, 'allow');
  const pw = classifyType('x', t({ tag: 'input', type: 'password', isTextEntry: true, isPassword: true }));
  assert.ok(pw.type === 'needs_you' && pw.reason === 'login');
  const otp = classifyType('123456', t({ tag: 'input', type: 'text', isTextEntry: true, isOneTimeCode: true }));
  assert.ok(otp.type === 'needs_you' && otp.reason === 'two_factor');
});

test('projection: allowlisted job fields only, each with a source', () => {
  const fields = projectJobForComputer(
    {
      job: { title: 'T', claimNumber: 'C-1', policyNumber: 'P-1', description: 'long private description' },
      facts: {
        'Insured name': 'Ann',
        'Lockbox code': '1234',
        'Alarm code': '9',
        'Adjuster email': 'adj@example.test',
        'Favorite color': 'blue',
        'Customer PIN': '77',
      },
      messages: [{ body: 'note' }],
    },
    '3 Test Rd',
  );
  const keys = fields.map((f) => f.key);
  assert.deepEqual(keys, ['job.title', 'job.claimNumber', 'job.policyNumber', 'job.address', 'fact.insured_name', 'fact.adjuster_email']);
  assert.ok(fields.every((f) => f.source));
  assert.ok(!JSON.stringify(fields).includes('1234'));
  assert.ok(!JSON.stringify(fields).includes('private description'));
});

test("metering: 'computer' is its own feature labelled Computer", () => {
  assert.ok(TOKEN_FEATURES.includes('computer'));
  assert.equal(TOKEN_FEATURE_LABELS.computer, 'Computer');
  assert.equal(featureLabel('computer'), 'Computer');
  assert.equal(classifyTokenFeature('computer_agent'), 'computer');
  assert.equal(classifyTokenFeature('computer_session'), 'computer');
  assert.equal(classifyTokenFeature('ask'), 'ask', 'Chat is unchanged');
});

test('every /api/chat-computer route sits behind requireAuth and the org check', async () => {
  // A share-link viewer has no session, so requireAuth answers 401 before any
  // handler runs; every handler then calls requireOrgContext (org members only).
  const { computerRouter } = await import('../src/routes/computer.js');
  const { requireAuth } = await import('../src/middleware/requireAuth.js');
  const stack = (computerRouter as unknown as { stack: Array<{ handle: unknown; route?: { path: string } }> }).stack;
  assert.equal(stack[0].handle, requireAuth, 'requireAuth runs first');
  const routes = stack.filter((l) => l.route).map((l) => l.route!.path);
  assert.deepEqual(routes, [
    '/status',
    '/tasks/:id',
    '/tasks/:id/live',
    '/tasks/:id/hand-back',
    '/tasks/:id/resume',
    '/tasks/:id/cancel',
    '/approvals/:id/approve',
    '/approvals/:id/cancel',
    '/logins',
    '/logins/sign-ins',
    '/logins/sign-ins/:id/live',
    '/logins/sign-ins/:id/done',
    '/logins/sign-ins/:id/cancel',
    '/logins/:id',
    '/logins/:id/credential',
    '/logins/:id/credential',
  ]);
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/routes/computer.ts', import.meta.url), 'utf8');
  // Saved-password routes use requireGlobalAdmin, which runs requireOrgContext first.
  const orgChecks = (src.match(/await requireOrgContext\(req\)/g) ?? []).length;
  const adminChecks = (src.match(/await requireGlobalAdmin\(req\)/g) ?? []).length;
  assert.equal(adminChecks, 2, 'saving and deleting a password need a Global Admin');
  assert.equal(orgChecks + adminChecks, routes.length, 'each handler checks org membership');
  assert.match(src, /Cache-Control', 'no-store'/);
});

test('Browserbase credentials tolerate NAME=value and quotes pasted from a .env file', async () => {
  const { cleanEnvSecret } = await import('../src/computer/config.js');
  assert.equal(cleanEnvSecret('BROWSERBASE_API_KEY', 'BROWSERBASE_API_KEY=bb_test_x '), 'bb_test_x');
  assert.equal(cleanEnvSecret('BROWSERBASE_API_KEY', '"bb_test_x"'), 'bb_test_x');
  assert.equal(cleanEnvSecret('BROWSERBASE_PROJECT_ID', " 'p-1' "), 'p-1');
  assert.equal(cleanEnvSecret('BROWSERBASE_API_KEY', 'bb_test_x'), 'bb_test_x');
  assert.equal(cleanEnvSecret('BROWSERBASE_API_KEY', undefined), '');
});

test('email and site-action commands route to start_computer_task', () => {
  for (const q of [
    'email Pat a summary of how things are going',
    'Send an email to adjuster@carrier.test with a status update',
    'update the claim on portal.example-carrier.test',
    'use Outlook',
    'add a photo on the Xactimate estimate page at identity.xactware.com',
  ]) {
    assert.equal(looksLikeComputerTask(q), true, q);
    assert.deepEqual(pickAskToolsHeuristically(q, 'org'), ['start_computer_task'], q);
  }
  assert.ok(!looksLikeComputerTask('draft a progress share message'));
  assert.ok(!pickAskToolsHeuristically('draft a progress share message for the homeowner', 'org').includes('start_computer_task'));
});

test('start_computer_task with a matching Login sets start URL and sign_in_saved instructions', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null });
  await store.saveLogin({
    org_id: ORG,
    label: 'Outlook',
    url: 'https://outlook.office.com/',
    host: 'outlook.office.com',
    cookie_domains: [],
    user_id: USER,
    at: new Date().toISOString(),
  });
  const result = await executeAskTool(
    'start_computer_task',
    { instructions: 'email pat@example.test a summary of how things are going' },
    ctx('org'),
  );
  assert.equal(result.ok, true, result.summary);
  const [task] = [...store.tasks.values()];
  assert.equal(task.start_url, 'https://outlook.office.com/');
  assert.match(task.instructions, /sign_in_saved/);
  assert.match(task.instructions, /request_approval/);
  assert.match(task.instructions, /Never click Send/);
  assert.match(task.instructions, /pat@example\.test/);
  assert.match(result.summary, /Outlook/);
  assert.equal((result.data as { loginHost?: string }).loginHost, 'outlook.office.com');
});

test('start_computer_task without a matching Login for a named site points at Logins', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null });
  const result = await executeAskTool(
    'start_computer_task',
    { instructions: 'update the estimate in Xactimate' },
    ctx('org'),
  );
  assert.equal(result.ok, false);
  assert.match(result.summary, /Logins/);
  assert.equal(store.tasks.size, 0);
  assert.equal(result.ui?.path, 'logins');
});

test('email the homeowner uses job-file email; missing email asks in Chat', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null });
  await store.saveLogin({
    org_id: ORG,
    label: 'Outlook',
    url: 'https://outlook.office.com/',
    host: 'outlook.office.com',
    cookie_domains: [],
    user_id: USER,
    at: new Date().toISOString(),
  });
  const withEmail = ctx('org');
  withEmail.file = {
    job: { claimNumber: 'CLM-T-1', title: 'Test roof' },
    facts: { Homeowner: 'Pat Test', 'Homeowner email': 'pat@example.test' },
  };
  const ok = await executeAskTool(
    'start_computer_task',
    { instructions: 'email the homeowner a status update' },
    withEmail,
  );
  assert.equal(ok.ok, true, ok.summary);
  const [task] = [...store.tasks.values()];
  assert.match(task.instructions, /pat@example\.test/);
  assert.match(task.instructions, /request_approval/);

  store.tasks.clear();
  const noEmail = ctx('org');
  noEmail.file = { job: { title: 'Test roof' }, facts: { Homeowner: 'Pat Test' } };
  const ask = await executeAskTool(
    'start_computer_task',
    { instructions: 'email the homeowner a status update' },
    noEmail,
  );
  assert.equal(ask.ok, false);
  assert.match(ask.summary, /email address for the homeowner/i);
  assert.equal(store.tasks.size, 0);
  assert.equal(ask.ui?.path, 'computer-task:need-detail');
});

test('CRM outstanding command queues a read-only status task', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null });
  await store.saveLogin({
    org_id: ORG,
    label: 'AccuLynx',
    url: 'https://app.acculynx.com/',
    host: 'app.acculynx.com',
    cookie_domains: [],
    user_id: USER,
    at: new Date().toISOString(),
  });
  const c = ctx('org');
  c.file = { job: { claimNumber: 'CLM-T-1', title: 'Test roof' }, facts: { 'Insured name': 'Pat Test' } };
  c.address = '2 Test St';
  assert.ok(looksLikeComputerTask("what's outstanding in AccuLynx for this job"));
  const result = await executeAskTool(
    'start_computer_task',
    { instructions: "what's outstanding in AccuLynx for this job" },
    c,
  );
  assert.equal(result.ok, true, result.summary);
  const [task] = [...store.tasks.values()];
  assert.equal(task.start_url, 'https://app.acculynx.com/');
  assert.match(task.instructions, /Flag:/);
  assert.match(task.instructions, /CLM-T-1/);
  assert.match(task.instructions, /Do not change/i);
});

test('build estimate in Xactimate queues a task that enters line items inside Xactimate', async () => {
  const store = new MemoryComputerStore();
  setComputerProviderForTests(new MockComputerProvider());
  setComputerWorkerDepsForTests({ store, admin: null });
  await store.saveLogin({
    org_id: ORG,
    label: 'Xactimate',
    url: 'https://identity.xactware.com/',
    host: 'identity.xactware.com',
    cookie_domains: [],
    user_id: USER,
    at: new Date().toISOString(),
  });
  await store.saveLogin({
    org_id: ORG,
    label: 'DocuSketch',
    url: 'https://app.docusketch.com/',
    host: 'app.docusketch.com',
    cookie_domains: [],
    user_id: USER,
    at: new Date().toISOString(),
  });
  const c = ctx('org');
  c.file = {
    job: { claimNumber: 'CLM-T-1', title: 'Hail roof' },
    facts: { 'Roof squares': '18', Homeowner: 'Pat Test', Sketch: 'DocuSketch' },
    scope: [{ state: 'included', title: 'R&R shingles' }],
  };
  assert.ok(looksLikeComputerTask('build the estimate in Xactimate for this job'));
  const result = await executeAskTool(
    'start_computer_task',
    { instructions: 'build the estimate in Xactimate for this job' },
    c,
  );
  assert.equal(result.ok, true, result.summary);
  const [task] = [...store.tasks.values()];
  assert.equal(task.start_url, 'https://app.docusketch.com/');
  assert.match(task.instructions, /STEP 1/);
  assert.match(task.instructions, /INSIDE Xactimate|complete working estimate/i);
  assert.match(task.instructions, /Roof squares|18/);
  assert.match(task.instructions, /request_approval/);
  assert.match(result.summary, /sketch|Xactimate/i);
});
