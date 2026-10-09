/**
 * Logins page on the mock provider: a person opens a site in the org's
 * browser, signs in themselves, presses Done, and the site is listed. Remove
 * clears that site's cookies from the profile. No model runs, only browser
 * time is metered, and the one-live-browser-per-org rule holds.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { computerSettings } from '../src/computer/config.js';
import {
  cancelSignIn,
  classifyWarmup,
  finishSignIn,
  loginsState,
  removeLogin,
  resetSignInsForTests,
  signInLiveView,
  startSignIn,
  verifyLogin,
} from '../src/computer/logins.js';
import { MockComputerProvider, MockSite } from '../src/computer/providers/mock.js';
import { setComputerProviderForTests } from '../src/computer/providers/index.js';
import { ComputerServiceError, startComputerTask } from '../src/computer/service.js';
import { MemoryComputerStore } from '../src/computer/store.js';
import { runComputerTask, setComputerWorkerDepsForTests } from '../src/computer/worker.js';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000b2';
const USER = '00000000-0000-4000-8000-0000000000c3';

function setup(opts: { configured?: boolean; paused?: boolean } = {}) {
  const store = new MemoryComputerStore();
  const site = new MockSite();
  const provider = new MockComputerProvider({ site, configured: opts.configured ?? true });
  const rpc: Array<{ name: string; params: Record<string, unknown> }> = [];
  const meteringClient = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      rpc.push({ name, params });
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  let now = Date.now();
  setComputerProviderForTests(provider);
  setComputerWorkerDepsForTests({
    admin: null,
    store,
    provider,
    meteringClient,
    model: { async create() { throw new Error('no model on the Logins page'); } } as never,
    isPaused: async () => false,
    sleep: async () => undefined,
    now: () => now,
    settings: { ...computerSettings(), pollMs: 1 },
    assertAiAllowed: async () => {
      if (opts.paused) throw new Error('AI is paused for this account.');
    },
  });
  return { store, site, provider, rpc, advance: (ms: number) => (now += ms) };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

async function rejectsWith(p: Promise<unknown>, code: string, re?: RegExp) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof ComputerServiceError, String(err));
    assert.equal(err.code, code);
    if (re) assert.match(err.message, re);
    return true;
  });
}

afterEach(() => {
  resetSignInsForTests();
  setComputerProviderForTests(null);
  setComputerWorkerDepsForTests(null);
});

test('empty Logins page, and "not set up" without Browserbase', async () => {
  setup();
  const state = await loginsState(ORG, USER);
  assert.equal(state.configured, true);
  assert.deepEqual(state.logins, []);
  assert.equal(state.signingIn, null);
  assert.equal(state.busy, null);

  setup({ configured: false });
  const off = await loginsState(ORG, USER);
  assert.equal(off.configured, false);
  assert.match(off.message ?? '', /Computer isn't set up/);
  await rejectsWith(startSignIn({ orgId: ORG, userId: USER, url: 'outlook.office.com' }), 'not_set_up');
});

test('Add login: opens the site on the org profile, person signs in, Done saves it with only the changed cookie domains', async () => {
  const h = setup();
  h.site.cookies['.already-there.test'] = ['a|1|0'];
  const signIn = await startSignIn({ orgId: ORG, userId: USER, url: 'outlook.office.com', label: 'Outlook' });
  assert.equal(signIn.label, 'Outlook');
  assert.equal(signIn.host, 'outlook.office.com');
  assert.ok(h.site.actions.includes('navigate:https://outlook.office.com/'));
  const live = await h.store.liveSession(ORG);
  assert.equal(live?.purpose, 'login');
  assert.equal(h.provider.contexts, 1, 'created the org profile once');

  const state = await loginsState(ORG, USER);
  assert.equal(state.signingIn?.sessionId, signIn.sessionId);
  assert.equal(state.signingIn?.startedByYou, true);

  const link = await signInLiveView(ORG, signIn.sessionId, USER);
  assert.equal(link.mode, 'control');
  assert.equal(h.provider.liveLinks.length, 1);
  assert.ok(!JSON.stringify(h.store.audit).includes('live.mock.invalid'), 'live-view URL is never stored');

  // The person signs in through the live view (password + 2FA on Microsoft's pages).
  // Long, distinctive values: a short one like "9f" turns up in random UUIDs.
  const SECRET_A = 'SECRET-COOKIE-VALUE-x7q-estsauth';
  const SECRET_B = 'SECRET-COOKIE-VALUE-k3z-owa';
  h.site.cookies['.login.microsoftonline.com'] = [`ESTSAUTH|${SECRET_A}|0`];
  h.site.cookies['outlook.office.com'] = [`X-OWA|${SECRET_B}|0`];
  h.advance(90_000);

  const saved = await finishSignIn(ORG, signIn.sessionId, USER);
  assert.equal(saved.label, 'Outlook');
  assert.equal(saved.canClearCookies, true);
  assert.ok(saved.lastSignedInAt);
  const row = (await h.store.listLogins(ORG))[0];
  assert.deepEqual(row.cookie_domains, ['.login.microsoftonline.com', 'outlook.office.com']);
  for (const secret of [SECRET_A, SECRET_B]) {
    assert.ok(!JSON.stringify(row).includes(secret), 'no cookie values stored');
    assert.ok(!JSON.stringify(h.store.audit).includes(secret), 'no cookie values audited');
    assert.ok(!JSON.stringify(await h.store.listLogins(ORG)).includes('SECRET-COOKIE-VALUE'));
  }
  assert.equal(await h.store.liveSession(ORG), null, 'browser released');
  assert.equal(h.provider.ended.length, 1);

  await tick();
  assert.equal(h.rpc.filter((c) => c.params.p_source === 'computer_agent').length, 0, 'no model tokens');
  assert.equal(h.rpc.length, 1, 'one metering row: browser time');
  const browser = h.rpc.find((c) => c.params.p_source === 'computer_session');
  assert.ok(browser, 'browser time metered');
  assert.equal(browser!.params.p_feature, 'computer');
});

test('one browser per org: a running task or another sign-in blocks a new sign-in, with a clear message', async () => {
  const h = setup();
  const task = await startComputerTask({ orgId: ORG, userId: USER, jobId: null, instructions: 'Fill out the form on portal.example.test' });
  await h.store.updateTask(task.id, { status: 'running' });
  await rejectsWith(startSignIn({ orgId: ORG, userId: USER, url: 'gmail.com' }), 'conflict', /working on a task/);
  const state = await loginsState(ORG, USER);
  assert.match(state.busy ?? '', /working on a task/);

  await h.store.updateTask(task.id, { status: 'succeeded' });
  const first = await startSignIn({ orgId: ORG, userId: USER, url: 'gmail.com', label: 'Gmail' });
  await rejectsWith(startSignIn({ orgId: ORG, userId: USER, url: 'outlook.office.com' }), 'conflict', /signing in to Gmail/);
  await cancelSignIn(ORG, first.sessionId, USER);
  assert.equal((await h.store.listLogins(ORG)).length, 0, 'cancel saves nothing');
  assert.equal(await h.store.liveSession(ORG), null);
});

test('a Chat task queued during a sign-in waits, then runs after Done', async () => {
  const h = setup();
  const signIn = await startSignIn({ orgId: ORG, userId: USER, url: 'outlook.office.com' });
  const task = await startComputerTask({ orgId: ORG, userId: USER, jobId: null, instructions: 'Check the inbox on outlook.office.com' });
  assert.equal(await runComputerTask(task.id), null, 'not claimed while someone signs in');
  assert.equal((await h.store.getTask(ORG, task.id))?.status, 'queued');
  await finishSignIn(ORG, signIn.sessionId, USER);
  assert.equal((await h.store.liveSession(ORG)), null);
});

test('Sign in again reuses the saved site and updates it in place', async () => {
  const h = setup();
  const a = await startSignIn({ orgId: ORG, userId: USER, url: 'https://www.xactimate.com/login', label: 'Xactimate' });
  h.site.cookies['.xactimate.com'] = ['s|1|0'];
  const first = await finishSignIn(ORG, a.sessionId, USER);
  h.advance(60_000);
  const b = await startSignIn({ orgId: ORG, userId: USER, loginId: first.id });
  assert.equal(b.label, 'Xactimate');
  assert.ok(h.site.actions.filter((x) => x === 'navigate:https://www.xactimate.com/login').length === 2);
  h.site.cookies['.xactimate.com'] = ['s|2|0'];
  const again = await finishSignIn(ORG, b.sessionId, USER);
  assert.equal(again.id, first.id);
  assert.notEqual(again.lastSignedInAt, first.lastSignedInAt);
  assert.equal((await h.store.listLogins(ORG)).length, 1);
});

test('Remove clears that site\'s cookies and keeps a sign-in another listed site shares', async () => {
  const h = setup();
  const o = await startSignIn({ orgId: ORG, userId: USER, url: 'outlook.office.com', label: 'Outlook' });
  h.site.cookies['.login.microsoftonline.com'] = ['ESTSAUTH|1|0'];
  h.site.cookies['outlook.office.com'] = ['owa|1|0'];
  const outlook = await finishSignIn(ORG, o.sessionId, USER);
  const t = await startSignIn({ orgId: ORG, userId: USER, url: 'teams.microsoft.com', label: 'Teams' });
  h.site.cookies['.login.microsoftonline.com'] = ['ESTSAUTH|2|0'];
  h.site.cookies['teams.microsoft.com'] = ['tm|1|0'];
  await finishSignIn(ORG, t.sessionId, USER);
  const endedBefore = h.provider.ended.length;

  const out = await removeLogin(ORG, outlook.id, USER);
  assert.equal(out.cookiesCleared, true);
  assert.match(out.message, /shares with another site/);
  assert.equal(h.site.cookies['outlook.office.com'], undefined, 'Outlook cookies cleared');
  assert.ok(h.site.cookies['.login.microsoftonline.com'], 'shared Microsoft sign-in kept for Teams');
  assert.ok(h.site.cookies['teams.microsoft.com']);
  assert.deepEqual((await h.store.listLogins(ORG)).map((l) => l.label), ['Teams']);
  assert.equal(h.provider.ended.length, endedBefore + 1, 'sign-out browser released');
  assert.equal(await h.store.liveSession(ORG), null);
});

test('Remove while the browser is busy refuses and keeps the site', async () => {
  const h = setup();
  const s = await startSignIn({ orgId: ORG, userId: USER, url: 'gmail.com', label: 'Gmail' });
  h.site.cookies['.google.com'] = ['SID|1|0'];
  const gmail = await finishSignIn(ORG, s.sessionId, USER);
  await startSignIn({ orgId: ORG, userId: USER, url: 'outlook.office.com' });
  await rejectsWith(removeLogin(ORG, gmail.id, USER), 'conflict', /Remove needs the browser/);
  assert.equal((await h.store.listLogins(ORG)).length, 1);
});

test('another org cannot see, finish or remove this org\'s sign-ins', async () => {
  const h = setup();
  const s = await startSignIn({ orgId: ORG, userId: USER, url: 'gmail.com' });
  await rejectsWith(signInLiveView(OTHER_ORG, s.sessionId, USER), 'not_found');
  await rejectsWith(finishSignIn(OTHER_ORG, s.sessionId, USER), 'not_found');
  const saved = await finishSignIn(ORG, s.sessionId, USER);
  await rejectsWith(removeLogin(OTHER_ORG, saved.id, USER), 'not_found');
  assert.deepEqual((await loginsState(OTHER_ORG, USER)).logins, []);
  assert.equal((await h.store.listLogins(ORG)).length, 1);
});

test('a sign-in left open by a crash stops blocking after its time limit', async () => {
  const h = setup();
  await startSignIn({ orgId: ORG, userId: USER, url: 'gmail.com' });
  resetSignInsForTests(); // the process that held it is gone
  h.advance(18 * 60_000);
  const state = await loginsState(ORG, USER);
  assert.equal(state.busy, null);
  assert.equal(state.signingIn, null);
  assert.equal(await h.store.liveSession(ORG), null);
});

test('AI paused for the account refuses a sign-in', async () => {
  setup({ paused: true });
  await rejectsWith(startSignIn({ orgId: ORG, userId: USER, url: 'gmail.com' }), 'ai_paused');
});

test('bad addresses are refused', async () => {
  setup();
  await rejectsWith(startSignIn({ orgId: ORG, userId: USER, url: 'not a url' }), 'bad_request');
  await rejectsWith(startSignIn({ orgId: ORG, userId: USER, url: 'javascript:alert(1)' }), 'bad_request');
});

test('classifyWarmup: signed-in vs login / MFA / captcha without inventing credentials', () => {
  const login = { label: 'Outlook', host: 'outlook.office.com' };
  assert.equal(classifyWarmup(login, {
    url: 'https://outlook.office.com/mail',
    hasPasswordField: false,
    hasOneTimeCodeField: false,
    hasCaptcha: false,
    mentionsVerificationCode: false,
    approvalNumber: null,
    visibleOtpCode: null,
  }, 'https://outlook.office.com/mail').status, 'signed_in');
  assert.equal(classifyWarmup(login, {
    url: 'https://login.microsoftonline.com/',
    hasPasswordField: true,
    hasOneTimeCodeField: false,
    hasCaptcha: false,
    mentionsVerificationCode: false,
    approvalNumber: null,
    visibleOtpCode: null,
  }, null).status, 'needs_sign_in');
  assert.equal(classifyWarmup(login, {
    url: 'https://login.microsoftonline.com/verify',
    hasPasswordField: false,
    hasOneTimeCodeField: true,
    hasCaptcha: false,
    mentionsVerificationCode: true,
    approvalNumber: null,
    visibleOtpCode: null,
  }, null).status, 'two_factor');
  assert.match(classifyWarmup(login, {
    url: 'https://x',
    hasPasswordField: false,
    hasOneTimeCodeField: false,
    hasCaptcha: true,
    mentionsVerificationCode: false,
    approvalNumber: null,
    visibleOtpCode: null,
  }, null).message, /never solves captchas/i);
  assert.equal(classifyWarmup(login, {
    url: 'https://x',
    hasPasswordField: false,
    hasOneTimeCodeField: false,
    hasCaptcha: false,
    mentionsVerificationCode: false,
    approvalNumber: '47',
    visibleOtpCode: null,
  }, null).status, 'number_match');
});

test('Check login: opens the org profile, reports signed-in on the form page, releases the browser', async () => {
  const h = setup();
  h.site.page = 'form';
  const s = await startSignIn({ orgId: ORG, userId: USER, url: 'portal.example-carrier.test', label: 'Carrier' });
  const saved = await finishSignIn(ORG, s.sessionId, USER);
  const check = await verifyLogin(ORG, saved.id, USER);
  assert.equal(check.status, 'signed_in');
  assert.match(check.message, /signed in/i);
  assert.ok(h.site.actions.some((a) => a.startsWith('navigate:')));
  assert.equal(await h.store.liveSession(ORG), null);
  assert.ok(h.provider.ended.length >= 2);
});

test('Check login: login page reports needs_sign_in', async () => {
  const h = setup();
  const s = await startSignIn({ orgId: ORG, userId: USER, url: 'portal.example-carrier.test', label: 'Carrier' });
  const saved = await finishSignIn(ORG, s.sessionId, USER);
  h.site.page = 'login';
  const check = await verifyLogin(ORG, saved.id, USER);
  assert.equal(check.status, 'needs_sign_in');
  assert.match(check.message, /Sign in again/);
});

test('Check login refuses when a task or sign-in holds the browser', async () => {
  setup();
  const s = await startSignIn({ orgId: ORG, userId: USER, url: 'gmail.com', label: 'Gmail' });
  const saved = await finishSignIn(ORG, s.sessionId, USER);
  await startSignIn({ orgId: ORG, userId: USER, url: 'outlook.office.com' });
  await rejectsWith(verifyLogin(ORG, saved.id, USER), 'conflict');
});

test('custom website without a name: named from the domain (or the catalog), opens the address', async () => {
  setup();
  const s = await startSignIn({ orgId: ORG, userId: USER, url: 'portal.acme-carrier.test' });
  assert.equal(s.label, 'Acme Carrier');
  const saved = await finishSignIn(ORG, s.sessionId, USER);
  assert.equal(saved.label, 'Acme Carrier');
  assert.equal(saved.url, 'https://portal.acme-carrier.test/');
  await removeLogin(ORG, saved.id, USER, true);
  const o = await startSignIn({ orgId: ORG, userId: USER, url: 'outlook.office.com' });
  assert.match(o.label, /Outlook/);
});
