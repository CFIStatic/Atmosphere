import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const coreSrc = readFileSync(resolve(repoRoot, 'fieldcapture/js/capture-core.js'), 'utf8');
const fieldApp = readFileSync(resolve(repoRoot, 'fieldcapture/js/app.js'), 'utf8');

type Session = { accessToken: string; refreshToken: string | null; email?: string } | null;
type Core = {
  adoptPlatformSession: (apiBase: string) => Promise<Session>;
  signOutPlatform: (apiBase: string, refreshToken?: string | null) => Promise<boolean>;
  refreshSession: (apiBase: string, refreshToken: string | null) => Promise<Session>;
};

function loadCore(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
  const sandbox: Record<string, unknown> = { console, URL, URLSearchParams, fetch: fetchImpl };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(coreSrc, sandbox);
  return sandbox.FieldCaptureCore as Core;
}

function json(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const API = 'https://platform.atmosphereteam.com';

describe('Field Capture single sign-on with the Platform', () => {
  it('trades the Platform session cookie for a session, sending credentials and no token', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      json(200, {
        user: { email: 'jack@roitechai.com' },
        session: { accessToken: 'acc', refreshToken: 'ref', expiresAt: 1 },
      }),
    );
    const Core = loadCore(fetchMock);
    const session = await Core.adoptPlatformSession(API);
    expect(session).toMatchObject({ accessToken: 'acc', refreshToken: 'ref', email: 'jack@roitechai.com' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://platform.atmosphereteam.com/api/auth/refresh');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(String(init.body))).toEqual({});
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('shows sign-in (null) when there is no Platform session', async () => {
    const Core = loadCore(() => json(401, { error: 'Not signed in' }));
    await expect(Core.adoptPlatformSession(API)).resolves.toBeNull();
  });

  it('signs the Platform out too, so the shared cookie cannot sign this tab back in', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => json(200, { ok: true }));
    const Core = loadCore(fetchMock);
    await expect(Core.signOutPlatform(API, 'ref')).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://platform.atmosphereteam.com/api/auth/logout');
    expect(init.credentials).toBe('include');
  });

  it('boots from the Platform session before showing sign-in, and only for the invited email', () => {
    const boot = fieldApp.slice(fieldApp.indexOf('function connectStoredSession('));
    const adopt = boot.indexOf('Core.adoptPlatformSession(API_BASE)');
    expect(adopt).toBeGreaterThan(-1);
    expect(boot.slice(adopt, adopt + 700)).toContain('sameInvitee');
    expect(boot.slice(adopt, adopt + 700)).toContain('INVITE_EMAIL');
  });

  it('renews an expired access token on reload instead of dropping to sign-in', () => {
    const fn = fieldApp.slice(
      fieldApp.indexOf('function connectStoredSession('),
      fieldApp.indexOf('function renewBootSession('),
    );
    expect(fn).toContain('err.status === 401');
    expect(fn).toContain('renewBootSession()');
    expect(fn).toContain('connectStoredSession(true)');
  });

  it('renews mid-session from the cookie and never stores a cookie-backed refresh token', () => {
    const fn = fieldApp.slice(fieldApp.indexOf('function refreshAccess('), fieldApp.indexOf('function sessionExpired('));
    expect(fn).toContain('state.refreshToken || null');
    expect(fn).toContain('refreshToken ? session.refreshToken || refreshToken : null');
  });

  it('an adopted Platform session keeps its refresh token in the httpOnly cookie only (security review)', () => {
    const boot = fieldApp.slice(fieldApp.indexOf('Core.adoptPlatformSession(API_BASE)'));
    expect(boot.slice(0, 900)).toContain('writeStoredSession(session.accessToken, null)');
  });

  it('boot renewal shares the single-flight refresh with the film queue (no double rotation)', () => {
    const fn = fieldApp.slice(fieldApp.indexOf('function renewBootSession('), fieldApp.indexOf('function renewBootSession(') + 300);
    expect(fn).toContain('refreshAccess(captureSession())');
  });

  it('sign-out waits for the Platform logout and blocks re-adoption in this tab', () => {
    const helper = fieldApp.slice(fieldApp.indexOf('function signOutEverywhere('), fieldApp.indexOf('function writeStoredSession('));
    expect(helper).toContain("sessionStorage.setItem(NO_ADOPT_KEY, '1')");
    expect(helper).toContain('Core.signOutPlatform(API_BASE, refreshToken)');
    const signOut = fieldApp.slice(fieldApp.indexOf('function signOutFieldAccount('), fieldApp.indexOf('function signOutFieldAccount(') + 2000);
    expect(signOut).toContain('signOutEverywhere().then(');
    expect(fieldApp).toContain('Core.adoptPlatformSession && platformAdoptionAllowed()');
    // Terms-gate sign-out and a failed office join sign out everywhere too.
    const terms = fieldApp.slice(fieldApp.indexOf("when('#terms-sign-out'"), fieldApp.indexOf("when('#terms-sign-out'") + 500);
    expect(terms).toContain('signOutEverywhere()');
    const failJoin = fieldApp.slice(fieldApp.indexOf('function failJoinOffice('), fieldApp.indexOf('function failJoinOffice(') + 300);
    expect(failJoin).toContain('signOutEverywhere()');
  });

  it('a password sign-in re-allows Platform adoption', () => {
    expect((fieldApp.match(/allowPlatformAdoption\(\);\n\s+writeStoredSession\(session\.accessToken, session\.refreshToken\)/g) || []).length).toBe(2);
  });
});
