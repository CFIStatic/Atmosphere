import { randomUUID } from 'node:crypto';

/**
 * Consent for acting on a user's Xactimate account.
 *
 * Signing into someone's Xactimate account is acting as them inside a system
 * that holds their carrier relationships and their customers' claim data. That
 * is not something a checkbox in a settings page should authorise once and
 * forever, so consent here is an explicit, recorded, *scoped* and *expiring*
 * grant, and the driver layer refuses to do anything without a live one.
 *
 * The properties that matter:
 *
 *   - **Scoped.** Reading a price list is a different permission from writing an
 *     estimate into the account. A user who only wants pricing help never grants
 *     write access.
 *   - **Expiring.** Grants lapse. The default is 30 days, and re-consenting is a
 *     few seconds of work.
 *   - **Revocable, immediately.** Revocation also destroys any stored
 *     credentials — see `credentials.ts`.
 *   - **Auditable.** Every action taken under a grant is logged against it with
 *     what was done and when, so the user can see exactly what happened in their
 *     account.
 */

/** What a grant permits. Requested individually, never bundled by default. */
export type ConsentScope =
  /** Sign in and read profile/price-list metadata. */
  | 'read_profile'
  /** Download the account's price lists for reconciliation. */
  | 'read_price_list'
  /** Read existing estimates and claims. */
  | 'read_estimates'
  /** Create a new estimate in the account. */
  | 'write_estimate'
  /** Submit an estimate to a carrier through XactAnalysis. */
  | 'submit_estimate';

export const ALL_SCOPES: readonly ConsentScope[] = [
  'read_profile',
  'read_price_list',
  'read_estimates',
  'write_estimate',
  'submit_estimate',
];

/**
 * Scopes granted by default when a user connects an account. Submission is
 * deliberately excluded: sending an estimate to a carrier is an irreversible,
 * outward-facing act and must be asked for on its own.
 */
export const DEFAULT_SCOPES: readonly ConsentScope[] = [
  'read_profile',
  'read_price_list',
  'read_estimates',
];

export const SCOPE_DESCRIPTIONS: Record<ConsentScope, string> = {
  read_profile: 'Sign in to your Xactimate account and read your profile',
  read_price_list: 'Download your price lists so estimates use your real prices',
  read_estimates: 'Read your existing estimates and claims',
  write_estimate: 'Create new estimates in your account',
  submit_estimate: 'Submit estimates to carriers on your behalf',
};

/** Default grant lifetime. */
export const DEFAULT_CONSENT_DAYS = 30;

export interface ConsentGrant {
  id: string;
  userId: string;
  orgId: string | null;
  scopes: ConsentScope[];
  grantedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  /** Recorded at grant time so the user can recognise the session later. */
  grantedFromIp: string | null;
  grantedUserAgent: string | null;
  /** Xactimate login the grant covers. Stored for display, never as a secret. */
  xactimateUsername: string;
  /** Whether credentials may be stored at rest, or only held for one request. */
  storageMode: CredentialStorageMode;
}

/**
 * How long credentials are allowed to live.
 *
 * `session` is the default and the safe one: the password is used for a single
 * operation and never written anywhere. `stored` exists because unattended runs
 * (a nightly sync, a scheduled submission) cannot prompt for a password — it
 * costs the user an extra, explicit opt-in.
 */
export type CredentialStorageMode = 'session' | 'stored';

export interface CreateConsentInput {
  userId: string;
  orgId: string | null;
  xactimateUsername: string;
  scopes: ConsentScope[];
  storageMode?: CredentialStorageMode;
  ip?: string | null;
  userAgent?: string | null;
  days?: number;
}

export function createConsent(input: CreateConsentInput): ConsentGrant {
  const now = new Date();
  const days = input.days ?? DEFAULT_CONSENT_DAYS;

  const scopes = [...new Set(input.scopes)].filter((scope): scope is ConsentScope =>
    (ALL_SCOPES as readonly string[]).includes(scope),
  );
  if (scopes.length === 0) {
    throw new Error('A consent grant must include at least one scope.');
  }

  return {
    id: randomUUID(),
    userId: input.userId,
    orgId: input.orgId,
    scopes,
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    revokedAt: null,
    grantedFromIp: input.ip ?? null,
    grantedUserAgent: input.userAgent ?? null,
    xactimateUsername: input.xactimateUsername,
    storageMode: input.storageMode ?? 'session',
  };
}

export function isLive(grant: ConsentGrant | null | undefined): grant is ConsentGrant {
  if (!grant) return false;
  if (grant.revokedAt) return false;
  return Date.parse(grant.expiresAt) > Date.now();
}

export function hasScope(grant: ConsentGrant | null | undefined, scope: ConsentScope): boolean {
  return isLive(grant) && grant.scopes.includes(scope);
}

/**
 * Throws unless the grant is live and covers the scope. Called at the top of
 * every driver operation — a scope check that can be forgotten is not a scope
 * check, so the driver base class makes it unforgettable.
 */
export function assertScope(grant: ConsentGrant | null | undefined, scope: ConsentScope): void {
  if (!isLive(grant)) {
    throw new ConsentError(
      'Your Xactimate authorisation has expired or was revoked. Reconnect the account to continue.',
      'consent_expired',
    );
  }
  if (!grant.scopes.includes(scope)) {
    throw new ConsentError(
      `This action needs permission to "${SCOPE_DESCRIPTIONS[scope]}", which you have not granted.`,
      'consent_scope_missing',
    );
  }
}

export class ConsentError extends Error {
  readonly code: string;
  constructor(message: string, code = 'consent_error') {
    super(message);
    this.name = 'ConsentError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * Audit
 * ------------------------------------------------------------------ */

/**
 * Every action taken against a user's account, recorded against the grant that
 * allowed it. This is what makes the permission meaningful rather than
 * decorative — the user can ask "what did it do in my account?" and get an
 * answer.
 */
export interface ConsentAuditEntry {
  id: string;
  consentId: string;
  userId: string;
  scope: ConsentScope;
  action: string;
  /** Free-form, non-sensitive detail. Never credentials, never claim contents. */
  detail: string;
  succeeded: boolean;
  at: string;
}

export function auditEntry(
  grant: ConsentGrant,
  scope: ConsentScope,
  action: string,
  detail: string,
  succeeded: boolean,
): ConsentAuditEntry {
  return {
    id: randomUUID(),
    consentId: grant.id,
    userId: grant.userId,
    scope,
    action,
    detail,
    succeeded,
    at: new Date().toISOString(),
  };
}
