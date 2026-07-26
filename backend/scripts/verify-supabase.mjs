#!/usr/bin/env node
/**
 * End-to-end verification of the auth stack against a real Supabase project.
 *
 * Exercises the whole path a user actually takes — sign up, sign in, session
 * restore, onboarding, PIN enrollment, PIN unlock, password recovery, sign out —
 * through the BFF, not through supabase-js directly. That distinction matters:
 * it is the only way to prove the cookie handling, the RLS-scoped queries, and
 * the BFF's own error mapping all work together.
 *
 *   Terminal 1:  cd backend && npm run dev
 *   Terminal 2:  cd backend && npm run verify:supabase
 *
 * The test account is created and then deleted. Deleting it requires
 * SUPABASE_SERVICE_ROLE_KEY; without it the script still runs and simply tells
 * you which address to remove by hand.
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:4000';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://ccxatzfsvzetciiwsjlj.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// A throwaway address per run so repeat runs never collide.
const EMAIL = `verify-${Date.now()}@atmosphere-verify.test`;
const PASSWORD = 'Verify-Correct-Horse-9182';
const NEW_PASSWORD = 'Verify-Rotated-Horse-5514';
const PIN = '8305';

let passed = 0;
let failed = 0;
let skipped = 0;
const jar = new Map();

function record(name, ok, detail = '') {
  const mark = ok === 'skip' ? '○' : ok ? '✓' : '✗';
  if (ok === 'skip') skipped++;
  else if (ok) passed++;
  else failed++;
  console.log(`  ${mark} ${name}${detail ? `  — ${detail}` : ''}`);
}

/** Minimal cookie jar, so the script exercises the same httpOnly flow a browser would. */
function storeCookies(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }
  return raw;
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = storeCookies(res);
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text.slice(0, 120) };
  }
  return { status: res.status, body: json, setCookie };
}

console.log(`\nAtmosphere · Supabase verification`);
console.log(`  BFF:      ${BASE}`);
console.log(`  Supabase: ${SUPABASE_URL}`);
console.log(`  Account:  ${EMAIL}\n`);

// ── 0. Reachability ─────────────────────────────────────────────────────────
console.log('Connectivity');
const health = await call('GET', '/api/health').catch((e) => ({ status: 0, body: { e: e.message } }));
record('BFF is running', health.status === 200, `HTTP ${health.status}`);
if (health.status !== 200) {
  console.log('\n  Start it first:  cd backend && npm run dev\n');
  process.exit(1);
}

const reachable = await fetch(`${SUPABASE_URL}/auth/v1/health`).then(
  (r) => r.ok || r.status === 401,
  () => false,
);
record('Supabase auth endpoint reachable', reachable);
if (!reachable) {
  console.log(
    '\n  Supabase is unreachable from this machine. If you are behind a corporate\n' +
      '  proxy or egress allowlist, that host has to be permitted before the\n' +
      '  backend can authenticate anyone.\n',
  );
  process.exit(1);
}

// ── 1. Sign up ──────────────────────────────────────────────────────────────
console.log('\nSign up');
const signup = await call('POST', '/api/auth/signup', { email: EMAIL, password: PASSWORD });
record('creates an account', signup.status === 201, `HTTP ${signup.status}`);
const needsConfirm = signup.body?.needsEmailConfirmation === true;
record(
  needsConfirm ? 'email confirmation required (project setting)' : 'session issued immediately',
  true,
  needsConfirm ? 'confirm the address to finish, or disable confirmations' : '',
);

// ── 2. Rejections ───────────────────────────────────────────────────────────
console.log('\nInput handling');
const short = await call('POST', '/api/auth/signup', { email: 'x@y.com', password: 'short' });
record('rejects a short password', short.status === 400, short.body?.error ?? '');
const badEmail = await call('POST', '/api/auth/login', { email: 'nope', password: PASSWORD });
record('rejects a malformed email', badEmail.status === 400, badEmail.body?.error ?? '');

if (needsConfirm) {
  console.log('\n  Remaining checks need a confirmed account — stopping here.');
  console.log(`  Confirm ${EMAIL} (or turn off email confirmation) and re-run.\n`);
  process.exit(failed ? 1 : 0);
}

// ── 3. Sign in ──────────────────────────────────────────────────────────────
console.log('\nSign in');
jar.clear();
const wrong = await call('POST', '/api/auth/login', { email: EMAIL, password: 'not-the-password' });
record('rejects the wrong password', wrong.status === 401, wrong.body?.code ?? '');
record(
  'wrong password does not reveal whether the account exists',
  wrong.body?.error === 'Invalid email or password',
  wrong.body?.error ?? '',
);

const login = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
record('accepts the right password', login.status === 200, `HTTP ${login.status}`);
record('returns the user', login.body?.user?.email === EMAIL, login.body?.user?.email ?? '');

const cookieLines = login.setCookie.join(' | ');
record('sets an access-token cookie', /atm_access_token=/.test(cookieLines));
record('sets a refresh-token cookie', /atm_refresh_token=/.test(cookieLines));
record(
  'session cookies are HttpOnly',
  login.setCookie.filter((c) => /atm_/.test(c)).every((c) => /HttpOnly/i.test(c)),
  'not readable by page JavaScript',
);
record(
  'no token appears in the response body',
  !JSON.stringify(login.body).match(/access_token|refresh_token|eyJ/),
);

// ── 4. Session ──────────────────────────────────────────────────────────────
console.log('\nSession');
const me = await call('GET', '/api/auth/me');
record('restores the session from cookies alone', me.status === 200 && me.body?.user?.email === EMAIL);
const refreshed = await call('POST', '/api/auth/refresh');
record('refreshes the session', refreshed.status === 200, `HTTP ${refreshed.status}`);

// ── 5. Onboarding under RLS ─────────────────────────────────────────────────
console.log('\nOnboarding (RLS-scoped)');
const before = await call('GET', '/api/org/me');
record('new user has no membership yet', before.status === 200 && before.body?.membership === null);
const org = await call('POST', '/api/org', {
  name: 'Verification Restoration Co',
  role: 'project_manager',
  workType: 'mitigation',
});
record('creates an organization', org.status === 201 || org.status === 200, `HTTP ${org.status}`);
const after = await call('GET', '/api/org/me');
record('membership now resolves', after.body?.membership?.org?.name === 'Verification Restoration Co');
record('role persisted', after.body?.membership?.role === 'project_manager');
const members = await call('GET', '/api/org/members');
record('member directory returns the caller', (members.body?.members ?? []).length === 1);

// ── 6. Device PIN ───────────────────────────────────────────────────────────
console.log('\nDevice PIN');
const weak = await call('POST', '/api/auth/pin/enroll', { pin: '1234' });
if (weak.status === 503) {
  record('PIN sign-in configured', 'skip', 'SUPABASE_SERVICE_ROLE_KEY not set — feature stays hidden');
} else {
  record('rejects a guessable PIN', weak.status === 400, weak.body?.error ?? '');
  const enroll = await call('POST', '/api/auth/pin/enroll', { pin: PIN });
  record('enrolls a PIN', enroll.status === 201, `HTTP ${enroll.status}`);
  const status = await call('GET', '/api/auth/pin/status');
  record('device reports as enrolled', status.body?.enrolled === true);

  const sessionCookies = new Map(jar);
  jar.delete('atm_access_token');
  jar.delete('atm_refresh_token');
  const badPin = await call('POST', '/api/auth/pin/unlock', { pin: '9999' });
  record('rejects the wrong PIN', badPin.status === 401, badPin.body?.error ?? '');
  const unlock = await call('POST', '/api/auth/pin/unlock', { pin: PIN });
  record('unlocks with the right PIN', unlock.status === 200, `HTTP ${unlock.status}`);
  record('unlock returns the same user', unlock.body?.user?.email === EMAIL);
  for (const [k, v] of sessionCookies) if (!jar.has(k)) jar.set(k, v);
}

// ── 7. Password recovery ────────────────────────────────────────────────────
console.log('\nPassword recovery');
const forgotKnown = await call('POST', '/api/auth/forgot-password', { email: EMAIL });
const forgotUnknown = await call('POST', '/api/auth/forgot-password', {
  email: 'definitely-not-registered@atmosphere-verify.test',
});
record('accepts a reset request', forgotKnown.status === 200);
record(
  'answers identically for unknown addresses (no account enumeration)',
  forgotKnown.status === forgotUnknown.status &&
    JSON.stringify(forgotKnown.body) === JSON.stringify(forgotUnknown.body),
);
const badReset = await call('POST', '/api/auth/reset-password', {
  tokenHash: 'obviously-invalid',
  password: NEW_PASSWORD,
});
record('rejects an invalid reset token', badReset.status === 401, badReset.body?.code ?? '');

// ── 8. Sign out ─────────────────────────────────────────────────────────────
console.log('\nSign out');
const logout = await call('POST', '/api/auth/logout');
record('signs out', logout.status === 200);
const afterLogout = await call('GET', '/api/auth/me');
record('session no longer valid', afterLogout.status === 401, `HTTP ${afterLogout.status}`);

// ── 9. Cleanup ──────────────────────────────────────────────────────────────
console.log('\nCleanup');
if (SERVICE_KEY) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers();
  const user = data?.users?.find((u) => u.email === EMAIL);
  if (user) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    record('test account removed', !error, error?.message ?? EMAIL);
  } else {
    record('test account removed', true, 'not found');
  }
} else {
  record('test account removed', 'skip', `delete ${EMAIL} by hand, or set SUPABASE_SERVICE_ROLE_KEY`);
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
process.exit(failed ? 1 : 0);
