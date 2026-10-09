/**
 * Saved usernames and passwords for Logins, so Computer signs back in on
 * its own. Uses a long, distinctive fake password and checks it never shows
 * up anywhere it shouldn't: model requests, audit rows, API responses, task
 * views or logs. Also: AES-256-GCM round trip, Global Admin only, and the
 * feature turned off cleanly without COMPUTER_CREDENTIAL_KEY.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import express from 'express';
import type { AddressInfo } from 'node:net';
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ContentBlock, ComputerModel, ComputerModelRequest, ComputerModelResponse } from '../src/computer/agent.js';
import { computerSettings } from '../src/computer/config.js';
import {
  CREDENTIALS_OFF_MESSAGE,
  CredentialsOffError,
  canOpenFingerprint,
  credentialKeyFingerprint,
  credentialsEnabled,
  needsReseal,
  openCredential,
  resealCredential,
  sealCredential,
} from '../src/computer/credentialCrypto.js';
import { rotateComputerCredentials } from '../src/computer/rotateCredentials.js';
import { loginsState, resetSignInsForTests, saveCredential } from '../src/computer/logins.js';
import { MockComputerProvider, MockSite } from '../src/computer/providers/mock.js';
import { setComputerProviderForTests } from '../src/computer/providers/index.js';
import { loadTaskView, resumeTask, startComputerTask } from '../src/computer/service.js';
import { MemoryComputerStore } from '../src/computer/store.js';
import { runComputerTask, setComputerWorkerDepsForTests } from '../src/computer/worker.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

const ORG = '0a000000-0000-4000-8000-0000000000c1';
const ADMIN = '0c000000-0000-4000-8000-0000000000c2';
const MEMBER = '0c000000-0000-4000-8000-0000000000c3';
const JOB = '0d000000-0000-4000-8000-0000000000c4';

/** Long and distinctive so a partial leak would still be caught. */
const PASSWORD = 'PW-SECRET-zq9-Atmosphere-TEST-7781-hunter2-do-not-leak';
const USERNAME = 'saved.user.zq9@example-carrier.test';
const KEY = 'test-only-computer-credential-key-0123456789abcdef';
const SITE_HOST = 'portal.example-carrier.test';

const savedKey = process.env.COMPUTER_CREDENTIAL_KEY;
const savedPreviousKeys = process.env.COMPUTER_CREDENTIAL_KEY_PREVIOUS;
const NEW_KEY = 'a-rotated-test-key-that-is-long-enough-1234567';

/* ------------------------------------------------------------- log capture -- */

let logs: string[] = [];
const restore: Array<() => void> = [];
function captureLogs() {
  logs = [];
  for (const name of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const orig = console[name];
    console[name] = (...args: unknown[]) => {
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    restore.push(() => (console[name] = orig));
  }
  for (const stream of [process.stdout, process.stderr]) {
    const orig = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      logs.push(String(chunk));
      return (orig as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
    restore.push(() => (stream.write = orig as typeof stream.write));
  }
}

function assertNoSecret(where: string, value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.ok(!text.includes(PASSWORD), `password leaked into ${where}`);
  assert.ok(!text.includes(PASSWORD.slice(8, 30)), `part of the password leaked into ${where}`);
}

beforeEach(() => {
  process.env.COMPUTER_CREDENTIAL_KEY = KEY;
  captureLogs();
});

afterEach(() => {
  while (restore.length) restore.pop()!();
  assertNoSecret('logs', logs.join('\n'));
  resetSignInsForTests();
  setComputerProviderForTests(null);
  setComputerWorkerDepsForTests(null);
  if (savedKey === undefined) delete process.env.COMPUTER_CREDENTIAL_KEY;
  else process.env.COMPUTER_CREDENTIAL_KEY = savedKey;
  if (savedPreviousKeys === undefined) delete process.env.COMPUTER_CREDENTIAL_KEY_PREVIOUS;
  else process.env.COMPUTER_CREDENTIAL_KEY_PREVIOUS = savedPreviousKeys;
});

/* ---------------------------------------------------------------- harness -- */

let seq = 0;
const tool = (name: string, input: Record<string, unknown>): ContentBlock => ({ type: 'tool_use', id: `tu_${(seq += 1)}`, name, input });

function scripted(turns: ContentBlock[][]) {
  const seen: ComputerModelRequest[] = [];
  const model: ComputerModel = {
    async create(req): Promise<ComputerModelResponse> {
      seen.push(JSON.parse(JSON.stringify(req)));
      const content = turns[seen.length - 1] ?? [tool('finish', { title: 'Done', fields: [], submitted: false })];
      return { model: 'claude-sonnet-5', content, usage: { input_tokens: 1000, output_tokens: 100 } };
    },
  };
  return { model, seen };
}

function setup(opts: { site?: MockSite; turns?: ContentBlock[][]; person?: (h: { store: MemoryComputerStore; site: MockSite; taskId: string }) => Promise<void> } = {}) {
  const store = new MemoryComputerStore();
  const site = opts.site ?? new MockSite({ start: 'login', account: { username: USERNAME, password: PASSWORD } });
  const provider = new MockComputerProvider({ site });
  const { model, seen } = scripted(opts.turns ?? []);
  const h = { store, site, taskId: '' };
  const meteringClient = { rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
  setComputerProviderForTests(provider);
  setComputerWorkerDepsForTests({
    admin: null,
    store,
    provider,
    model,
    meteringClient,
    isPaused: async () => false,
    sleep: async () => {
      await opts.person?.(h);
    },
    settings: { ...computerSettings(), pollMs: 1, idleTimeoutMs: 2_000 },
    assertAiAllowed: async () => undefined,
  });
  return { ...h, h, seen, provider };
}

/** The Computer routes behind a stand-in for sign-in: the request's org context is set directly. */
async function api(role: 'global_admin' | 'office_manager' | 'employee' | 'project_manager', userId = role.includes('admin') || role === 'office_manager' ? ADMIN : MEMBER) {
  const { computerRouter } = await import('../src/routes/computer.js');
  const { toOrgProductRole } = await import('../src/lib/productRoles.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as Record<symbol, unknown>)[Symbol.for('atmosphere.orgContext')] = {
      orgId: ORG,
      userId,
      role,
      productRole: toOrgProductRole(role),
      supabase: null,
    };
    next();
  });
  // Mount the route handlers without the router's requireAuth (no real session in tests).
  const routes = express.Router();
  const stack = (computerRouter as unknown as { stack: Array<{ route?: unknown }> }).stack.filter((l) => l.route);
  (routes as unknown as { stack: unknown[] }).stack.push(...stack);
  app.use('/api/chat-computer', routes);
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat-computer`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, text, json: text ? JSON.parse(text) : null };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

async function seedLogin(store: MemoryComputerStore, host = SITE_HOST) {
  return store.saveLogin({
    org_id: ORG,
    label: 'Carrier portal',
    url: `https://${host}/login`,
    host,
    cookie_domains: [],
    user_id: ADMIN,
    at: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------- encryption -- */

test('AES-256-GCM round trip; the sealed text never contains the password', () => {
  const sealed = sealCredential(PASSWORD, ORG, 'login-1', 'password');
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
  assertNoSecret('sealed value', sealed);
  assert.equal(openCredential(sealed, ORG, 'login-1', 'password'), PASSWORD);
  assert.notEqual(sealCredential(PASSWORD, ORG, 'login-1', 'password'), sealed, 'a fresh IV every time');
  // Bound to its org, site and field: a copied value can't be opened anywhere else.
  assert.throws(() => openCredential(sealed, ORG, 'login-2', 'password'), /Saved sign-in is not readable/);
  assert.throws(() => openCredential(sealed, ORG, 'login-1', 'username'), /Saved sign-in is not readable/);
  // Tampering fails.
  const parts = sealed.split('.');
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('A') ? 'BB' : 'AA');
  assert.throws(() => openCredential(parts.join('.'), ORG, 'login-1', 'password'));
  // Another key can't open it, and the error never carries the value.
  process.env.COMPUTER_CREDENTIAL_KEY = 'a-completely-different-test-key-9876543210zyx';
  assert.throws(
    () => openCredential(sealed, ORG, 'login-1', 'password'),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, 'Saved sign-in is not readable.');
      return true;
    },
  );
});

test('without COMPUTER_CREDENTIAL_KEY saving passwords is off, with a plain message', async () => {
  delete process.env.COMPUTER_CREDENTIAL_KEY;
  assert.equal(credentialsEnabled(), false);
  assert.throws(() => sealCredential(PASSWORD, ORG, 'l', 'password'), CredentialsOffError);
  process.env.COMPUTER_CREDENTIAL_KEY = 'too-short';
  assert.equal(credentialsEnabled(), false, 'a short key does not count');
  delete process.env.COMPUTER_CREDENTIAL_KEY;

  const { store } = setup();
  const login = await seedLogin(store);
  const state = await loginsState(ORG, ADMIN, true);
  assert.deepEqual(state.passwords, { enabled: false, message: CREDENTIALS_OFF_MESSAGE, canManage: true });

  const admin = await api('global_admin');
  try {
    const put = await admin.call('PUT', `/logins/${login.id}/credential`, { username: USERNAME, password: PASSWORD });
    assert.equal(put.status, 503);
    assert.equal(put.json.code, 'credentials_disabled');
    assert.equal(put.json.error, CREDENTIALS_OFF_MESSAGE);
    const signIn = await admin.call('POST', '/logins/sign-ins', { url: SITE_HOST, credential: { username: USERNAME, password: PASSWORD } });
    assert.equal(signIn.status, 503);
    assertNoSecret('disabled responses', put.text + signIn.text);
    assert.equal((await store.listCredentials(ORG)).length, 0);
  } finally {
    await admin.close();
  }
});

/* ------------------------------------------------------------------ roles -- */

test('only a Global Admin can save, see the username of, replace or delete a saved password', async () => {
  const { store } = setup();
  const login = await seedLogin(store);
  const admin = await api('global_admin');
  const manager = await api('office_manager');
  const member = await api('employee');
  const pm = await api('project_manager');
  try {
    // Members can't save or delete.
    for (const who of [member, pm]) {
      const put = await who.call('PUT', `/logins/${login.id}/credential`, { username: USERNAME, password: PASSWORD });
      assert.equal(put.status, 403);
      assert.equal(put.json.code, 'insufficient_role');
      const start = await who.call('POST', '/logins/sign-ins', { url: SITE_HOST, credential: { username: USERNAME, password: PASSWORD } });
      assert.equal(start.status, 403);
      assertNoSecret('member responses', put.text + start.text);
    }
    assert.equal((await store.listCredentials(ORG)).length, 0);

    // An admin saves it; the response says "saved" and shows the username, never the password.
    const put = await admin.call('PUT', `/logins/${login.id}/credential`, { username: USERNAME, password: PASSWORD, loginUrl: `https://${SITE_HOST}/login` });
    assert.equal(put.status, 200, put.text);
    assertNoSecret('save response', put.text);
    assert.equal(put.json.login.credential.saved, true);
    assert.equal(put.json.login.credential.username, USERNAME);
    assert.equal(put.json.login.credential.status, 'ok');

    // Stored sealed: neither the password nor the username is in the row.
    const row = (await store.getCredential(ORG, login.id))!;
    assertNoSecret('stored row', row);
    assert.ok(!JSON.stringify(row).includes(USERNAME), 'username is sealed too');

    // Office managers count as Global Admin; employees see only "password saved".
    const asManager = await manager.call('GET', '/logins');
    assert.equal(asManager.json.logins[0].credential.username, USERNAME);
    assert.equal(asManager.json.passwords.canManage, true);
    const asMember = await member.call('GET', '/logins');
    assert.equal(asMember.json.logins[0].credential.saved, true);
    assert.equal(asMember.json.logins[0].credential.username, null);
    assert.equal(asMember.json.passwords.canManage, false);
    assertNoSecret('list responses', asManager.text + asMember.text);
    assert.ok(!asMember.text.includes(USERNAME), 'members never get the username');

    // Members can't delete the password, or remove a site that has one.
    assert.equal((await member.call('DELETE', `/logins/${login.id}/credential`)).status, 403);
    const memberRemove = await member.call('DELETE', `/logins/${login.id}`);
    assert.equal(memberRemove.status, 403);
    assert.match(memberRemove.json.error, /Global Admin/);
    assert.ok(await store.getCredential(ORG, login.id));

    // Replace, then delete.
    const replaced = await manager.call('PUT', `/logins/${login.id}/credential`, { username: 'other@example.test', password: `${PASSWORD}-2` });
    assert.equal(replaced.status, 200);
    assert.equal(replaced.json.login.credential.username, 'other@example.test');
    const del = await admin.call('DELETE', `/logins/${login.id}/credential`);
    assert.deepEqual(del.json, { deleted: true });
    assert.equal(await store.getCredential(ORG, login.id), null);

    // Bad input is refused without repeating it.
    const bad = await admin.call('PUT', `/logins/${login.id}/credential`, { username: USERNAME, password: PASSWORD.repeat(20) });
    assert.equal(bad.status, 400);
    assertNoSecret('validation error', bad.text);
  } finally {
    await Promise.all([admin.close(), manager.close(), member.close(), pm.close()]);
  }
  // Audit rows say what happened to which site, nothing more.
  for (const row of store.audit) assertNoSecret('audit', row);
  assert.ok(store.audit.some((r) => r.event === 'credential_saved' && r.detail.host === SITE_HOST));
  assert.ok(store.audit.some((r) => r.event === 'credential_deleted'));
});

test('Remove deletes the saved password with the site', async () => {
  const { store } = setup();
  const login = await seedLogin(store);
  await saveCredential({ orgId: ORG, loginId: login.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  const admin = await api('global_admin');
  try {
    const res = await admin.call('DELETE', `/logins/${login.id}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(await store.getLogin(ORG, login.id), null);
    assert.equal(await store.getCredential(ORG, login.id), null);
    assert.equal((await store.listCredentials(ORG)).length, 0);
  } finally {
    await admin.close();
  }
});

/* -------------------------------------------------- Add login with password -- */

test('Add login with a password: saved sealed, typed in by the server, response shows only the outcome', async () => {
  const site = new MockSite({ start: 'login', account: { username: USERNAME, password: PASSWORD, twoFactor: true } });
  const { store } = setup({ site });
  const admin = await api('global_admin');
  try {
    const res = await admin.call('POST', '/logins/sign-ins', {
      url: `https://${SITE_HOST}/login`,
      label: 'Carrier portal',
      credential: { username: USERNAME, password: PASSWORD },
    });
    assert.equal(res.status, 200, res.text);
    assertNoSecret('sign-in response', res.text);
    assert.equal(res.json.signIn.autoSignIn.outcome, 'two_factor');
    assert.match(res.json.signIn.autoSignIn.message, /verification code/);
    assert.equal(site.page, 'two_factor', 'the site accepted the saved password');
    assert.deepEqual(site.signInAttempts, [{ username: USERNAME, passwordLength: PASSWORD.length, ok: true }]);
    const logins = await store.listLogins(ORG);
    assert.equal(logins.length, 1);
    assert.equal(logins[0].last_signed_in_at, null, 'listed, but not signed in until Done');
    const state = await admin.call('GET', '/logins');
    assert.equal(state.json.logins[0].credential.saved, true);
    assertNoSecret('state', state.text);
  } finally {
    await admin.close();
  }
  for (const row of store.audit) assertNoSecret('audit', row);
  const auto = store.audit.find((r) => r.event === 'auto_sign_in')!;
  assert.deepEqual(auto.detail, { host: SITE_HOST, outcome: 'two_factor' });
});

/* --------------------------------------------------------- Computer tasks -- */

async function startTask(h: { taskId: string }, instructions = `Fill out the new claim form on ${SITE_HOST} for this job.`) {
  const task = await startComputerTask({
    orgId: ORG,
    userId: MEMBER,
    jobId: JOB,
    instructions,
    file: { job: { title: 'TEST job', claimNumber: 'CLM-TEST-1' }, facts: {}, messages: [] },
    address: '1 Test Lane',
  });
  h.taskId = task.id;
  return task;
}

test('a task signs in with the saved login: the model never sees the username or password', async () => {
  const t = setup({
    turns: [[tool('sign_in_saved', { site: SITE_HOST })], [tool('finish', { title: 'Signed in', fields: [], submitted: false })]],
  });
  const login = await seedLogin(t.store);
  await saveCredential({ orgId: ORG, loginId: login.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  await startTask(t.h);
  const out = await runComputerTask(t.h.taskId);
  assert.equal(out?.status, 'succeeded');
  assert.equal(t.site.page, 'form', 'signed in');
  assert.deepEqual(t.site.signInAttempts, [{ username: USERNAME, passwordLength: PASSWORD.length, ok: true }]);

  // The model is told the site has a saved sign-in, and nothing else about it.
  const first = t.seen[0].messages[0].content.find((b) => b.type === 'text')!.text as string;
  assert.match(first, /<saved_sign_ins>\n- Carrier portal \(portal\.example-carrier\.test\)\n<\/saved_sign_ins>/);
  assert.ok(t.seen[0].tools.some((x) => (x as { name?: string }).name === 'sign_in_saved'));
  for (const req of t.seen) {
    assertNoSecret('model request', req);
    assert.ok(!JSON.stringify(req).includes(USERNAME), 'the username never reaches the model');
  }
  const reply = JSON.stringify(t.seen[1].messages.at(-1));
  assert.match(reply, /Signed in to Carrier portal with the saved login/);

  // Audit: only "auto sign-in used for <host>".
  for (const row of t.store.audit) assertNoSecret('audit', row);
  const auto = t.store.audit.filter((r) => r.event === 'auto_sign_in');
  assert.equal(auto.length, 1);
  assert.deepEqual(auto[0].detail, { host: SITE_HOST, outcome: 'signed_in' });
  const view = await loadTaskView(ORG, t.h.taskId, MEMBER);
  assertNoSecret('task view', view);
  const cred = (await t.store.getCredential(ORG, login.id))!;
  assert.equal(cred.status, 'ok');
  assert.ok(cred.last_used_at);
});

test('needs_you for a sign-in on a saved site signs in on its own instead of pausing', async () => {
  const t = setup({
    turns: [[tool('needs_you', { reason: 'login', message: 'Please sign in.' })], [tool('finish', { title: 'Done', fields: [], submitted: false })]],
  });
  const login = await seedLogin(t.store);
  await saveCredential({ orgId: ORG, loginId: login.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  await startTask(t.h);
  const out = await runComputerTask(t.h.taskId);
  assert.equal(out?.status, 'succeeded');
  assert.equal(t.site.page, 'form');
  assert.ok(!t.store.audit.some((r) => r.event === 'needs_you'), 'no pause needed');
  for (const req of t.seen) assertNoSecret('model request', req);
});

test('a wrong saved password marks the login "needs attention" and pauses for the person', async () => {
  const site = new MockSite({ start: 'login', account: { username: USERNAME, password: 'the-real-password-is-different' } });
  let paused: { reason: string; message: string } | null = null;
  const t = setup({
    site,
    turns: [[tool('sign_in_saved', { site: SITE_HOST })], [tool('finish', { title: 'Done', fields: [], submitted: false })]],
    person: async (hh) => {
      const task = await hh.store.getTask(ORG, hh.taskId);
      if (task?.status === 'needs_you' && !task.resume_requested_at) {
        paused = { reason: task.needs_you!.reason, message: task.needs_you!.message };
        hh.site.completeHumanStep(); // the person signs in in the live view
        await resumeTask(ORG, hh.taskId, MEMBER);
      }
    },
  });
  const login = await seedLogin(t.store);
  await saveCredential({ orgId: ORG, loginId: login.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  await startTask(t.h);
  const out = await runComputerTask(t.h.taskId);
  assert.equal(out?.status, 'succeeded');
  assert.ok(paused, 'paused for the person');
  assert.equal(paused!.reason, 'login');
  assert.match(paused!.message, /saved password for Carrier portal didn't work/);
  const cred = (await t.store.getCredential(ORG, login.id))!;
  assert.equal(cred.status, 'needs_attention');
  assert.match(cred.attention_reason ?? '', /didn't work/);
  const state = await loginsState(ORG, MEMBER, false);
  assert.equal(state.logins[0].credential?.status, 'needs_attention');
  assertNoSecret('state', state);
  for (const req of t.seen) assertNoSecret('model request', req);
  for (const row of t.store.audit) assertNoSecret('audit', row);
  assert.ok(t.store.audit.some((r) => r.event === 'auto_sign_in' && r.detail.outcome === 'failed'));

  // Saving it again clears the flag.
  await saveCredential({ orgId: ORG, loginId: login.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  assert.equal((await t.store.getCredential(ORG, login.id))!.status, 'ok');
});

test('a code after the saved password uses the Needs-you pause; the code is never typed', async () => {
  const site = new MockSite({ start: 'login', account: { username: USERNAME, password: PASSWORD, twoFactor: true } });
  let reason = '';
  const t = setup({
    site,
    turns: [[tool('sign_in_saved', { site: 'Carrier portal' })], [tool('finish', { title: 'Done', fields: [], submitted: false })]],
    person: async (hh) => {
      const task = await hh.store.getTask(ORG, hh.taskId);
      if (task?.status === 'needs_you' && !task.resume_requested_at) {
        reason = task.needs_you!.reason;
        hh.site.completeHumanStep();
        await resumeTask(ORG, hh.taskId, MEMBER);
      }
    },
  });
  const login = await seedLogin(t.store);
  await saveCredential({ orgId: ORG, loginId: login.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  await startTask(t.h);
  const out = await runComputerTask(t.h.taskId);
  assert.equal(out?.status, 'succeeded');
  assert.equal(reason, 'two_factor');
  assert.equal(site.values.code, undefined);
  assert.equal((await t.store.getCredential(ORG, login.id))!.status, 'ok', 'the password worked');
});

test('the password is only typed on the saved site: elsewhere Computer opens the saved sign-in page first', async () => {
  const t = setup({
    turns: [[tool('sign_in_saved', { site: 'claims.other-carrier.test' })], [tool('finish', { title: 'Done', fields: [], submitted: false })]],
  });
  const login = await seedLogin(t.store, 'claims.other-carrier.test');
  await saveCredential({
    orgId: ORG,
    loginId: login.id,
    userId: ADMIN,
    canManage: true,
    credential: { username: USERNAME, password: PASSWORD, loginUrl: 'https://sso.other-carrier.test/signin' },
  });
  await startTask(t.h, 'Fill out the claim form on claims.other-carrier.test.');
  await runComputerTask(t.h.taskId);
  const nav = t.site.actions.indexOf('navigate:https://sso.other-carrier.test/signin');
  const fill = t.site.actions.indexOf('fill_sign_in');
  assert.ok(nav >= 0 && fill > nav, `navigated to the saved sign-in page before typing (${t.site.actions.join(', ')})`);
});

test('a key change makes the saved password unreadable: needs attention, never a crash', async () => {
  const t = setup({ turns: [[tool('sign_in_saved', { site: SITE_HOST })]], person: async (hh) => {
    const task = await hh.store.getTask(ORG, hh.taskId);
    if (task?.status === 'needs_you' && !task.resume_requested_at) {
      hh.site.completeHumanStep();
      await resumeTask(ORG, hh.taskId, MEMBER);
    }
  } });
  const login = await seedLogin(t.store);
  await saveCredential({ orgId: ORG, loginId: login.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  process.env.COMPUTER_CREDENTIAL_KEY = 'a-rotated-test-key-that-is-long-enough-1234567';
  await startTask(t.h);
  await runComputerTask(t.h.taskId);
  const cred = (await t.store.getCredential(ORG, login.id))!;
  assert.equal(cred.status, 'needs_attention');
  assert.match(cred.attention_reason ?? '', /different encryption key/);
  assert.deepEqual(t.site.signInAttempts, [], 'nothing was typed');
  const state = await loginsState(ORG, ADMIN, true);
  assert.equal(state.logins[0].credential?.username, null);
  assert.equal(state.logins[0].credential?.status, 'needs_attention');
});

test('key rotation: a previous key still opens old rows, and they are re-sealed with the new key', () => {
  const oldFingerprint = credentialKeyFingerprint();
  const row = {
    org_id: ORG,
    login_id: 'login-1',
    username_sealed: sealCredential(USERNAME, ORG, 'login-1', 'username'),
    password_sealed: sealCredential(PASSWORD, ORG, 'login-1', 'password'),
    key_fingerprint: oldFingerprint,
  };
  process.env.COMPUTER_CREDENTIAL_KEY = NEW_KEY;
  assert.equal(canOpenFingerprint(oldFingerprint), false, 'without the previous key listed, old rows are unreadable');
  assert.throws(() => resealCredential(row), /Saved sign-in is not readable/);

  process.env.COMPUTER_CREDENTIAL_KEY_PREVIOUS = `short, ${KEY}`;
  assert.equal(canOpenFingerprint(oldFingerprint), true);
  assert.equal(needsReseal(oldFingerprint), true);
  assert.equal(openCredential(row.password_sealed, ORG, 'login-1', 'password', oldFingerprint), PASSWORD);
  // Without the fingerprint only the current key is tried.
  assert.throws(() => openCredential(row.password_sealed, ORG, 'login-1', 'password'));

  const resealed = resealCredential(row)!;
  assertNoSecret('re-sealed value', resealed);
  assert.equal(resealed.key_fingerprint, credentialKeyFingerprint());
  assert.notEqual(resealed.key_fingerprint, oldFingerprint);
  assert.equal(needsReseal(resealed.key_fingerprint), false);
  delete process.env.COMPUTER_CREDENTIAL_KEY_PREVIOUS;
  assert.equal(openCredential(resealed.password_sealed, ORG, 'login-1', 'password'), PASSWORD, 'opens with only the new key');
  assert.equal(openCredential(resealed.username_sealed, ORG, 'login-1', 'username', resealed.key_fingerprint), USERNAME);
  assert.equal(resealCredential({ ...row, ...resealed }), null, 'already current');
});

test('rotateComputerCredentials: dry-run writes nothing, apply re-seals, unknown keys are reported', async () => {
  const seal = (loginId: string) => ({
    org_id: ORG,
    login_id: loginId,
    username_sealed: sealCredential(USERNAME, ORG, loginId, 'username'),
    password_sealed: sealCredential(PASSWORD, ORG, loginId, 'password'),
    key_fingerprint: credentialKeyFingerprint(),
  });
  const old = seal('login-old');
  process.env.COMPUTER_CREDENTIAL_KEY = 'some-retired-key-nobody-kept-0123456789-abcdef';
  const lost = seal('login-lost');
  process.env.COMPUTER_CREDENTIAL_KEY = NEW_KEY;
  process.env.COMPUTER_CREDENTIAL_KEY_PREVIOUS = KEY;
  const current = seal('login-current');
  const rows = [old, lost, current];

  const writes: Array<{ loginId: string; patch: Record<string, unknown> }> = [];
  const update = async (_orgId: string, loginId: string, patch: Record<string, unknown>) => {
    writes.push({ loginId, patch });
  };
  const dry = await rotateComputerCredentials({ rows, apply: false, update });
  assert.deepEqual(dry, { scanned: 3, current: 1, resealed: 1, unreadable: ['login-lost'] });
  assert.equal(writes.length, 0);

  const applied = await rotateComputerCredentials({ rows, apply: true, update });
  assert.equal(applied.resealed, 1);
  assert.deepEqual(writes.map((w) => w.loginId), ['login-old']);
  assert.equal(writes[0].patch.key_fingerprint, credentialKeyFingerprint());
  assertNoSecret('rotation writes', writes);
  delete process.env.COMPUTER_CREDENTIAL_KEY_PREVIOUS;
  assert.equal(openCredential(String(writes[0].patch.password_sealed), ORG, 'login-old', 'password'), PASSWORD);
});

test('auto sign-in with a previous key still signs in and re-seals the row with the current key', async () => {
  const t = setup({ turns: [[tool('sign_in_saved', { site: SITE_HOST })], [tool('finish', { title: 'Done', fields: [], submitted: false })]] });
  const login = await seedLogin(t.store);
  await saveCredential({ orgId: ORG, loginId: login.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  const oldFingerprint = (await t.store.getCredential(ORG, login.id))!.key_fingerprint;
  process.env.COMPUTER_CREDENTIAL_KEY = NEW_KEY;
  process.env.COMPUTER_CREDENTIAL_KEY_PREVIOUS = KEY;
  await startTask(t.h);
  await runComputerTask(t.h.taskId);
  assert.equal(t.site.signInAttempts.length, 1, 'signed in with the old-key password');
  const cred = (await t.store.getCredential(ORG, login.id))!;
  assert.notEqual(cred.key_fingerprint, oldFingerprint);
  assert.equal(cred.key_fingerprint, credentialKeyFingerprint());
  assert.equal(cred.status, 'ok');
  delete process.env.COMPUTER_CREDENTIAL_KEY_PREVIOUS;
  const state = await loginsState(ORG, ADMIN, true);
  assert.equal(state.logins[0].credential?.username, USERNAME, 'readable with only the new key');
});

test('without the key, tasks get no saved sign-ins and sign_in_saved says so', async () => {
  const t = setup({ turns: [[tool('sign_in_saved', { site: SITE_HOST })], [tool('finish', { title: 'Done', fields: [], submitted: false })]] });
  const login = await seedLogin(t.store);
  await saveCredential({ orgId: ORG, loginId: login.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  delete process.env.COMPUTER_CREDENTIAL_KEY;
  await startTask(t.h);
  await runComputerTask(t.h.taskId);
  const first = t.seen[0].messages[0].content.find((b) => b.type === 'text')!.text as string;
  assert.doesNotMatch(first, /saved_sign_ins/);
  assert.match(JSON.stringify(t.seen[1].messages.at(-1)), /No saved sign-in for that site/);
  assert.deepEqual(t.site.signInAttempts, []);
});

test('a saved sign-in is only used for a site the task names', async () => {
  const t = setup({ turns: [[tool('sign_in_saved', { site: 'mail.example-mail.test' })], [tool('finish', { title: 'Done', fields: [], submitted: false })]] });
  const mail = await seedLogin(t.store, 'mail.example-mail.test');
  await saveCredential({ orgId: ORG, loginId: mail.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  const portal = await seedLogin(t.store);
  await saveCredential({ orgId: ORG, loginId: portal.id, userId: ADMIN, canManage: true, credential: { username: USERNAME, password: PASSWORD } });
  await startTask(t.h);
  await runComputerTask(t.h.taskId);
  const first = t.seen[0].messages[0].content.find((b) => b.type === 'text')!.text as string;
  assert.match(first, /portal\.example-carrier\.test/);
  assert.doesNotMatch(first, /mail\.example-mail\.test/, 'only saved sites this task names are listed');
  assert.match(JSON.stringify(t.seen[1].messages.at(-1)), /No saved sign-in for that site/);
  assert.ok(!t.site.actions.includes('fill_sign_in'));
});
