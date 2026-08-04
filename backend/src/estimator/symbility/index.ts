import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../../config.js';

/**
 * Symbility (CoreLogic Claims Connect) — the connection.
 *
 * The other estimating platform. Many carrier programs mandate Symbility the
 * way others mandate Xactimate, and a restoration org routinely needs both
 * connected at once. This module is deliberately a subset of the Xactimate
 * stack: the connection lifecycle only — web sign-in as the user, a scoped and
 * expiring consent grant, session-only by default, revoke that destroys the
 * credential in the same act. Estimate push and price-list sync come when the
 * Symbility side of the estimator does; a connection that exists honestly is
 * worth more than a feature list that does not.
 *
 * Web login is the live path here on purpose ("for these it will be login via
 * web login"): there is no partner API wired, so the driver signs into Claims
 * Connect as the user in a real browser — with the same three honesty rules
 * the Xactimate web driver keeps:
 *
 *   - off unless explicitly enabled (SYMBILITY_WEB_AUTOMATION=true), because
 *     whether automation is permitted is between the account holder and
 *     CoreLogic;
 *   - it stops and asks on a second factor, never works around one;
 *   - selectors live in config, so a UI change is a config edit, not a deploy.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SymbilityScope = 'read_profile' | 'read_claims' | 'write_estimate';

export const SYMBILITY_SCOPES: readonly SymbilityScope[] = [
  'read_profile',
  'read_claims',
  'write_estimate',
];

export const SYMBILITY_SCOPE_DESCRIPTIONS: Record<
  SymbilityScope,
  { label: string; description: string; defaultGranted: boolean }
> = {
  read_profile: {
    label: 'See who is signed in',
    description: 'Read your name and company so the app can show which account is connected.',
    defaultGranted: true,
  },
  read_claims: {
    label: 'Read claim assignments',
    description: 'See the claims assigned to your account in Claims Connect.',
    defaultGranted: true,
  },
  write_estimate: {
    label: 'Write estimates',
    description: 'Create or update an estimate on a claim. Never submits without you.',
    defaultGranted: false,
  },
};

export interface SymbilityGrant {
  id: string;
  userId: string;
  orgId: string | null;
  username: string;
  scopes: SymbilityScope[];
  storageMode: 'session' | 'stored';
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip: string | null;
  userAgent: string | null;
}

export function createGrant(input: {
  userId: string;
  orgId: string | null;
  username: string;
  scopes: SymbilityScope[];
  storageMode?: 'session' | 'stored';
  days?: number;
  ip?: string | null;
  userAgent?: string | null;
}): SymbilityGrant {
  const scopes = [...new Set(input.scopes)].filter((s): s is SymbilityScope =>
    (SYMBILITY_SCOPES as readonly string[]).includes(s),
  );
  if (scopes.length === 0) throw new Error('A consent grant must include at least one scope.');
  const now = new Date();
  return {
    id: randomUUID(),
    userId: input.userId,
    orgId: input.orgId,
    username: input.username,
    scopes,
    storageMode: input.storageMode ?? 'session',
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.days ?? 30) * 86_400_000).toISOString(),
    revokedAt: null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  };
}

export function grantIsLive(grant: SymbilityGrant | null): grant is SymbilityGrant {
  if (!grant || grant.revokedAt) return false;
  return Date.parse(grant.expiresAt) > Date.now();
}

/* ------------------------------------------------------------------ *
 * Credential vault — same construction as the Xactimate vault: scrypt
 * per-record key over an env-only secret, AES-256-GCM, the user id bound
 * as AAD so a row copied to another user will not open.
 * ------------------------------------------------------------------ */

export interface SealedSymbilityCredential {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function isSymbilityVaultConfigured(): boolean {
  return Boolean(config.symbility.encryptionKey);
}

function deriveKey(salt: Buffer): Buffer {
  const secret = config.symbility.encryptionKey;
  if (!secret) {
    throw new SymbilityError(
      'Credential storage is not configured on this server. Set SYMBILITY_ENC_KEY, or connect in session-only mode — the safer option regardless.',
      'vault_unavailable',
    );
  }
  return scryptSync(secret, salt, 32, { maxmem: 64 * 1024 * 1024 });
}

export function sealSymbilityCredential(plaintext: string, userId: string): SealedSymbilityCredential {
  if (!plaintext) throw new Error('Refusing to seal an empty credential.');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(userId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  key.fill(0);
  return {
    v: 1,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}

export function openSymbilityCredential(sealed: SealedSymbilityCredential, userId: string): string {
  if (sealed?.v !== 1) throw new SymbilityError('That stored credential cannot be opened.', 'vault_open_failed');
  try {
    const key = deriveKey(Buffer.from(sealed.salt, 'hex'));
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'hex'), {
      authTagLength: 16,
    });
    decipher.setAAD(Buffer.from(userId, 'utf8'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'hex')),
      decipher.final(),
    ]);
    key.fill(0);
    return plaintext.toString('utf8');
  } catch (err) {
    if (err instanceof SymbilityError) throw err;
    throw new SymbilityError('That stored credential cannot be opened.', 'vault_open_failed');
  }
}

/* ------------------------------------------------------------------ *
 * Drivers
 * ------------------------------------------------------------------ */

export class SymbilityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export interface SymbilityProfile {
  username: string;
  displayName?: string;
  companyName?: string;
}

export interface SymbilitySession {
  id: string;
  kind: 'mock' | 'web';
  username: string;
  establishedAt: string;
  expiresAt: string;
  readonly handle: unknown;
}

export type SymbilityConnectResult =
  | { status: 'connected'; session: SymbilitySession; profile: SymbilityProfile }
  | { status: 'mfa_required'; challengeId: string; message: string }
  | { status: 'failed'; code: string; message: string };

export interface SymbilityConnectInput {
  username: string;
  password: string;
  mfaCode?: string;
}

export interface SymbilityDriver {
  readonly kind: 'mock' | 'web';
  connect(input: SymbilityConnectInput, grant: SymbilityGrant): Promise<SymbilityConnectResult>;
  close(session: SymbilitySession): Promise<void>;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const session = (kind: 'mock' | 'web', username: string, handle: unknown): SymbilitySession => ({
  id: randomUUID(),
  kind,
  username,
  establishedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  handle,
});

/** The default: the whole connect flow, no real credentials anywhere. */
class SymbilityMockDriver implements SymbilityDriver {
  readonly kind = 'mock' as const;

  async connect(input: SymbilityConnectInput): Promise<SymbilityConnectResult> {
    if (input.password === 'wrong') {
      return {
        status: 'failed',
        code: 'invalid_credentials',
        message: 'Claims Connect did not accept that username and password.',
      };
    }
    // The mock exercises the MFA path the same way the live site would: a
    // password containing 'mfa' asks for a code, then any 6 digits pass.
    if (input.password.includes('mfa') && !input.mfaCode) {
      return {
        status: 'mfa_required',
        challengeId: randomUUID(),
        message: 'Claims Connect asked for a verification code. Enter it to finish connecting.',
      };
    }
    return {
      status: 'connected',
      session: session('mock', input.username, null),
      profile: {
        username: input.username,
        displayName: input.username.split('@')[0],
        companyName: 'Mock — no real Symbility account was contacted',
      },
    };
  }

  async close(): Promise<void> {
    /* nothing held */
  }
}

/** Selectors, overridable without a redeploy when Claims Connect's UI moves. */
const DEFAULT_WEB_SELECTORS: Record<string, string> = {
  loginUrl: 'https://claimsconnect.symbility.net/login',
  usernameInput: 'input[name="username"]',
  passwordInput: 'input[type="password"]',
  submitButton: 'button[type="submit"]',
  mfaInput: 'input[name="verificationCode"]',
  mfaSubmit: 'button[data-action="verify"]',
  loginError: '[role="alert"]',
  profileName: '[data-testid="user-name"]',
};

class SymbilityWebDriver implements SymbilityDriver {
  readonly kind = 'web' as const;
  private readonly selectors: Record<string, string>;

  constructor() {
    if (!config.symbility.webAutomationEnabled) {
      throw new SymbilityError(
        'Browser automation of Claims Connect is disabled on this server. Set SYMBILITY_WEB_AUTOMATION=true to enable it, after confirming it is permitted under your CoreLogic account terms.',
        'web_driver_disabled',
      );
    }
    this.selectors = { ...DEFAULT_WEB_SELECTORS, ...config.symbility.webSelectors };
  }

  private async playwright(): Promise<any> {
    try {
      const moduleName = 'playwright';
      return await import(moduleName);
    } catch {
      throw new SymbilityError(
        'Browser automation needs Playwright, which is not installed. Run `npm install playwright` in backend/, or connect later when the server has it.',
        'playwright_missing',
      );
    }
  }

  async connect(input: SymbilityConnectInput): Promise<SymbilityConnectResult> {
    const { chromium } = await this.playwright();
    const browser = await chromium.launch({ headless: config.symbility.headless });
    const page = await (
      await browser.newContext({ viewport: { width: 1440, height: 900 } })
    ).newPage();

    try {
      await page.goto(this.selectors.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.fill(this.selectors.usernameInput, input.username, { timeout: 30_000 });
      await page.fill(this.selectors.passwordInput, input.password, { timeout: 30_000 });
      await page.click(this.selectors.submitButton, { timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);

      // Second factor: stop and ask. Never attempt to work around it.
      const needsMfa = await page.locator(this.selectors.mfaInput).count().catch(() => 0);
      if (needsMfa > 0) {
        if (!input.mfaCode) {
          await browser.close();
          return {
            status: 'mfa_required',
            challengeId: randomUUID(),
            message: 'Claims Connect asked for a verification code. Enter it to finish connecting.',
          };
        }
        await page.fill(this.selectors.mfaInput, input.mfaCode, { timeout: 30_000 });
        await page.click(this.selectors.mfaSubmit, { timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
      }

      const loginError = await page
        .locator(this.selectors.loginError)
        .first()
        .textContent({ timeout: 2_000 })
        .catch(() => null);
      if (loginError?.trim()) {
        await browser.close();
        return { status: 'failed', code: 'invalid_credentials', message: loginError.trim() };
      }

      const displayName = await page
        .locator(this.selectors.profileName)
        .first()
        .textContent({ timeout: 5_000 })
        .catch(() => null);

      return {
        status: 'connected',
        session: session('web', input.username, { browser, page }),
        profile: { username: input.username, displayName: displayName?.trim() || undefined },
      };
    } catch (err) {
      await browser.close().catch(() => undefined);
      throw new SymbilityError(
        `Could not reach the Claims Connect sign-in page: ${err instanceof Error ? err.message : 'unknown error'}`,
        'web_login_failed',
      );
    }
  }

  async close(sessionToClose: SymbilitySession): Promise<void> {
    const handle = sessionToClose.handle as { browser?: any } | null;
    await handle?.browser?.close?.().catch(() => undefined);
  }
}

export function createSymbilityDriver(kind: 'mock' | 'web' = config.symbility.driver): SymbilityDriver {
  return kind === 'web' ? new SymbilityWebDriver() : new SymbilityMockDriver();
}

/** Live sessions by user, evicted on TTL — mirrors the Xactimate session store. */
class SymbilitySessions {
  #sessions = new Map<string, { session: SymbilitySession; driver: SymbilityDriver; timer: NodeJS.Timeout }>();

  put(userId: string, s: SymbilitySession, driver: SymbilityDriver): void {
    this.#drop(userId);
    const timer = setTimeout(() => void this.close(userId), SESSION_TTL_MS);
    timer.unref?.();
    this.#sessions.set(userId, { session: s, driver, timer });
  }

  get(userId: string): SymbilitySession | null {
    const entry = this.#sessions.get(userId);
    if (!entry) return null;
    if (Date.parse(entry.session.expiresAt) <= Date.now()) {
      void this.close(userId);
      return null;
    }
    return entry.session;
  }

  async close(userId: string): Promise<void> {
    const entry = this.#sessions.get(userId);
    this.#drop(userId);
    if (entry) await entry.driver.close(entry.session).catch(() => undefined);
  }

  #drop(userId: string): void {
    const entry = this.#sessions.get(userId);
    if (entry) clearTimeout(entry.timer);
    this.#sessions.delete(userId);
  }
}

export const symbilitySessions = new SymbilitySessions();

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export async function saveSymbilityConnection(
  supabase: SupabaseClient,
  grant: SymbilityGrant,
  sealed: SealedSymbilityCredential | null,
): Promise<void> {
  const { error } = await supabase.from('symbility_connections').upsert({
    user_id: grant.userId,
    org_id: grant.orgId,
    consent_id: grant.id,
    symbility_username: grant.username,
    scopes: grant.scopes,
    storage_mode: grant.storageMode,
    granted_at: grant.grantedAt,
    expires_at: grant.expiresAt,
    revoked_at: null,
    granted_ip: grant.ip,
    granted_user_agent: grant.userAgent,
    sealed_credential: sealed,
  });
  if (error) throw new Error(`Could not save the Symbility connection: ${error.message}`);
}

export async function getSymbilityConnection(
  supabase: SupabaseClient,
  userId: string,
): Promise<SymbilityGrant | null> {
  const { data } = await supabase
    .from('symbility_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.consent_id,
    userId: data.user_id,
    orgId: data.org_id,
    username: data.symbility_username,
    scopes: (data.scopes ?? []) as SymbilityScope[],
    storageMode: data.storage_mode,
    grantedAt: data.granted_at,
    expiresAt: data.expires_at,
    revokedAt: data.revoked_at,
    ip: data.granted_ip,
    userAgent: data.granted_user_agent,
  };
}

/** Revoke and destroy the credential in the same statement — no window where
 * a revoked grant still has a usable password behind it. */
export async function revokeSymbilityConnection(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  await supabase
    .from('symbility_connections')
    .update({ revoked_at: new Date().toISOString(), sealed_credential: null })
    .eq('user_id', userId);
}

export async function recordSymbilityAudit(
  supabase: SupabaseClient,
  entry: {
    consentId: string;
    userId: string;
    scope: string;
    action: string;
    detail: string;
    succeeded: boolean;
  },
): Promise<void> {
  await supabase.from('symbility_audit').insert({
    consent_id: entry.consentId,
    user_id: entry.userId,
    scope: entry.scope,
    action: entry.action,
    detail: entry.detail,
    succeeded: entry.succeeded,
  });
}
