/**
 * Auto sign-in with a saved username and password.
 *
 * The server opens the sealed credential and types it straight into the
 * site's sign-in form through the browser driver. The plaintext lives only
 * in this function's locals: it is never put in a model message, a
 * screenshot taken for the model (password inputs render masked), a log
 * line, an error message or the audit log. The audit row records only the
 * site and the outcome.
 */
import { CREDENTIALS_OFF_MESSAGE, credentialKeyFingerprint, credentialsEnabled, openCredential } from './credentialCrypto.js';
import { hostOfUrl, siteOf } from './sites.js';
import type { ComputerCredentialRow, ComputerLoginRow, ComputerStore } from './store.js';
import { catalogSiteForHost, signInHostsFor } from './catalog/sites.js';
import type { ComputerDriver, SignInHints } from './types.js';

/**
 * Identity providers a site's own sign-in commonly hands off to. A saved
 * password may be typed there after the site's official sign-in page sent
 * the browser over (the login's credential is the account's password there).
 */
const COMMON_IDENTITY_SITES = ['microsoftonline.com', 'live.com', 'accounts.google.com', 'okta.com', 'auth0.com', 'b2clogin.com'];

/** Exact link names that open a sign-in form on a landing page, for sites without a catalog recipe. */
const GENERIC_OPEN_WITH = ['Sign in', 'Sign In', 'Log in', 'Log In', 'Login', 'LOGIN', 'SIGN IN'];

/** How to sign in to this login's site: the catalog recipe's link to open, and where typing is allowed. */
export function signInHintsFor(saved: SavedSignIn): SignInHints {
  const trusted = trustedSites(saved);
  const loginUrlHost = hostOfUrl(saved.credential.login_url);
  const site = catalogSiteForHost(saved.login.host) ?? catalogSiteForHost(loginUrlHost);
  const extra = new Set([...signInHostsFor(saved.login.host), ...signInHostsFor(loginUrlHost)].map((h) => h.toLowerCase()));
  return {
    openWith: site?.signIn?.flow === 'open_first' && site.signIn.openWith?.length ? site.signIn.openWith : GENERIC_OPEN_WITH,
    allowHost: (host) => {
      const h = host.toLowerCase();
      if (!h) return false;
      if (trusted.has(siteOf(h)) || extra.has(h)) return true;
      return COMMON_IDENTITY_SITES.some((d) => h === d || h.endsWith(`.${d}`));
    },
  };
}

export type AutoSignInOutcome =
  | 'signed_in'
  | 'already_signed_in'
  | 'two_factor'
  | 'number_match'
  | 'captcha'
  | 'failed'
  | 'incomplete'
  | 'unavailable';

export interface SavedSignIn {
  login: ComputerLoginRow;
  credential: ComputerCredentialRow;
}

export interface AutoSignInResult {
  outcome: AutoSignInOutcome;
  /** Plain words for the person (and the model). Never contains a credential. */
  message: string;
}

/** The org's sites that have a saved password (empty when saving passwords is off). */
export async function savedSignIns(store: ComputerStore, orgId: string): Promise<SavedSignIn[]> {
  if (!credentialsEnabled()) return [];
  const [logins, creds] = await Promise.all([store.listLogins(orgId), store.listCredentials(orgId)]);
  const byLogin = new Map(creds.map((c) => [c.login_id, c]));
  return logins.flatMap((login) => {
    const credential = byLogin.get(login.id);
    return credential ? [{ login, credential }] : [];
  });
}

/** Sites a saved password may be typed into without navigating there first. */
export function trustedSites(saved: SavedSignIn): Set<string> {
  const out = new Set<string>([siteOf(saved.login.host)]);
  const loginHost = hostOfUrl(saved.credential.login_url);
  if (loginHost) out.add(siteOf(loginHost));
  for (const d of saved.login.cookie_domains) {
    const host = d.replace(/^\./, '').toLowerCase();
    if (host) out.add(siteOf(host));
  }
  return out;
}

/** Match what the model or a page names (host, URL or the login's label) to a saved sign-in. */
export function findSavedSignIn(list: SavedSignIn[], name: string): SavedSignIn | null {
  const raw = String(name ?? '').trim().toLowerCase();
  if (!raw) return null;
  const host = hostOfUrl(raw) ?? hostOfUrl(`https://${raw.replace(/^\/+/, '')}`) ?? raw;
  const site = siteOf(host);
  return (
    list.find((s) => s.login.host === host) ??
    list.find((s) => trustedSites(s).has(site)) ??
    list.find((s) => s.login.label.trim().toLowerCase() === raw) ??
    null
  );
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
}

export async function autoSignIn(input: {
  store: ComputerStore;
  driver: ComputerDriver;
  saved: SavedSignIn;
  now: () => number;
  audit: { taskId?: string | null; sessionId?: string | null; jobId?: string | null; userId?: string | null };
}): Promise<AutoSignInResult> {
  const { store, driver, saved, now } = input;
  const { login, credential } = saved;
  const name = login.label || login.host;
  const at = new Date(now()).toISOString();

  const record = async (outcome: AutoSignInOutcome) => {
    await store
      .appendAudit({
        org_id: login.org_id,
        task_id: input.audit.taskId ?? null,
        session_id: input.audit.sessionId ?? null,
        job_id: input.audit.jobId ?? null,
        actor_kind: 'system',
        actor_user_id: input.audit.userId ?? null,
        event: 'auto_sign_in',
        detail: { host: login.host, outcome },
      })
      .catch(() => undefined);
  };
  const needsAttention = async (reason: string) => {
    await store
      .updateCredential(login.org_id, login.id, { status: 'needs_attention', attention_reason: reason.slice(0, 300) })
      .catch(() => undefined);
  };

  if (!credentialsEnabled()) {
    return { outcome: 'unavailable', message: CREDENTIALS_OFF_MESSAGE };
  }

  // Plaintext lives only in these locals, for this one call.
  let username: string;
  let password: string;
  try {
    if (credential.key_fingerprint !== credentialKeyFingerprint()) throw new Error('key changed');
    username = openCredential(credential.username_sealed, login.org_id, login.id, 'username');
    password = openCredential(credential.password_sealed, login.org_id, login.id, 'password');
  } catch {
    await needsAttention('This password was saved with a different encryption key. An admin needs to save it again.');
    await record('failed');
    return { outcome: 'failed', message: `The saved password for ${name} can't be read any more. An admin needs to save it again on Logins.` };
  }

  let filled: Awaited<ReturnType<ComputerDriver['fillSignIn']>>;
  let navigated = false;
  try {
    const currentHost = hostOfUrl(await driver.currentUrl().catch(() => ''));
    const trusted = trustedSites(saved);
    // Only ever type into the saved site's own pages. Anywhere else, open the saved sign-in page first.
    if (!currentHost || !trusted.has(siteOf(currentHost))) {
      await driver.navigate(credential.login_url ?? login.url);
      navigated = true;
    }
    const hints = signInHintsFor(saved);
    filled = await driver.fillSignIn({ username, password }, hints);
    if (filled === 'no_form' && !navigated) {
      await driver.navigate(credential.login_url ?? login.url);
      navigated = true;
      filled = await driver.fillSignIn({ username, password }, hints);
    }
  } catch {
    await record('incomplete');
    return { outcome: 'incomplete', message: `Computer couldn't fill in the sign-in form for ${name}.` };
  }

  if (filled === 'other_site') {
    await record('incomplete');
    return { outcome: 'incomplete', message: `${name} sent the sign-in to a different website, so Computer didn't type the saved password there. Please finish signing in yourself.` };
  }

  if (filled === 'no_form') {
    await store.updateCredential(login.org_id, login.id, { last_used_at: at }).catch(() => undefined);
    await record('already_signed_in');
    return { outcome: 'already_signed_in', message: `Already signed in to ${name}.` };
  }

  const signals = await driver.pageSignals().catch(() => null);
  let outcome: AutoSignInOutcome;
  let message: string;
  if (signals?.hasCaptcha) {
    outcome = 'captcha';
    message = `${name} showed a captcha after the saved sign-in.`;
  } else if (signals?.approvalNumber) {
    outcome = 'number_match';
    message = `The saved password worked. Approve ${signals.approvalNumber} on your phone.`;
  } else if (signals?.hasOneTimeCodeField || signals?.mentionsVerificationCode) {
    outcome = 'two_factor';
    message = `The saved password worked. ${name} is asking for a verification code.`;
  } else if (signals?.hasPasswordField) {
    outcome = 'failed';
    message = `The saved password for ${name} didn't work.`;
  } else if (filled === 'username_only') {
    outcome = 'incomplete';
    message = `Computer entered the username, but ${name} didn't ask for a password.`;
  } else {
    outcome = 'signed_in';
    message = `Signed in to ${name} with the saved login.`;
  }

  if (outcome === 'failed') {
    await needsAttention(`The saved password didn't work on ${shortDate(at)}.`);
  } else if (outcome !== 'incomplete') {
    await store
      .updateCredential(login.org_id, login.id, { status: 'ok', attention_reason: null, last_used_at: at })
      .catch(() => undefined);
  }
  await record(outcome);
  return { outcome, message };
}
