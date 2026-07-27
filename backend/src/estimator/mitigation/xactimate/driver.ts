import { assertScope, auditEntry, type ConsentAuditEntry, type ConsentGrant, type ConsentScope } from './consent.js';
import { redact } from './credentials.js';
import type { PriceList } from '../catalog/priceList.js';
import type { EstimateLineItem, MitigationEstimate } from '../types.js';

/**
 * The Xactimate driver interface.
 *
 * Xactimate is reachable three ways, and which one a given customer has depends
 * on their Verisk contract, not on anything this codebase controls:
 *
 *   1. **API** (`XactimateApiDriver`) — Verisk's XactAnalysis/Xactimate
 *      integration endpoints. The right answer when the org has a partner
 *      agreement: supported, stable, and no credential replay.
 *   2. **Browser automation** (`XactimateWebDriver`) — drives Xactimate Online
 *      as the user in a real browser session. The only option for orgs without
 *      API access, and the reason the consent and credential machinery in this
 *      folder exists.
 *   3. **File exchange** (`export/`) — generate an import file the user drops
 *      into Xactimate themselves. No login, no credentials, works everywhere.
 *
 * The pipeline that builds the estimate does not know or care which is in play,
 * so an org can start on file exchange and move to the API later without
 * touching a rule.
 *
 * Every operation goes through `guard()`, which checks the consent scope and
 * writes an audit entry whether the call succeeds or fails. A driver method that
 * skips it is a bug, not a shortcut.
 */

export type DriverKind = 'mock' | 'api' | 'web';

export interface XactimateProfile {
  username: string;
  displayName?: string;
  companyName?: string;
  /** Price lists the account can see. */
  availablePriceLists: Array<{ id: string; name: string; effectiveDate?: string }>;
}

/** An established, authenticated session. Opaque to callers. */
export interface XactimateSession {
  id: string;
  kind: DriverKind;
  username: string;
  establishedAt: string;
  expiresAt: string;
  /** Driver-private state — cookies, tokens, a browser context handle. */
  readonly handle: unknown;
}

export interface ConnectInput {
  username: string;
  password: string;
  /** Second factor, when the account requires one. */
  mfaCode?: string;
}

export type ConnectResult =
  | { status: 'connected'; session: XactimateSession; profile: XactimateProfile }
  /** The account has 2FA. Prompt the user and call `connect` again with the code. */
  | { status: 'mfa_required'; challengeId: string; message: string }
  | { status: 'failed'; code: string; message: string };

export interface EstimateSubmission {
  estimateId: string;
  /** Deep link the user can open to review it in Xactimate. */
  url?: string;
  lineItemsWritten: number;
  warnings: string[];
}

export interface XactimateDriver {
  readonly kind: DriverKind;

  connect(input: ConnectInput, grant: ConsentGrant): Promise<ConnectResult>;

  fetchPriceLists(
    session: XactimateSession,
    grant: ConsentGrant,
  ): Promise<XactimateProfile['availablePriceLists']>;

  fetchPriceList(session: XactimateSession, grant: ConsentGrant, priceListId: string): Promise<PriceList>;

  createEstimate(
    session: XactimateSession,
    grant: ConsentGrant,
    estimate: MitigationEstimate,
  ): Promise<EstimateSubmission>;

  addLineItems(
    session: XactimateSession,
    grant: ConsentGrant,
    estimateId: string,
    lineItems: EstimateLineItem[],
  ): Promise<EstimateSubmission>;

  disconnect(session: XactimateSession): Promise<void>;

  /** Audit entries produced since the driver was constructed. */
  drainAudit(): ConsentAuditEntry[];
}

export class DriverError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(message: string, code = 'xactimate_error', retryable = false) {
    super(message);
    this.name = 'DriverError';
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Shared driver plumbing: scope enforcement and audit, applied uniformly.
 *
 * `guard` wraps every operation so the permission check cannot be forgotten in a
 * new method and the audit trail cannot have holes in it. Failures are recorded
 * too — "it tried and was refused" is exactly what a user reviewing their
 * account history needs to see.
 */
export abstract class BaseXactimateDriver implements XactimateDriver {
  abstract readonly kind: DriverKind;

  readonly #audit: ConsentAuditEntry[] = [];

  protected async guard<T>(
    grant: ConsentGrant,
    scope: ConsentScope,
    action: string,
    detail: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    assertScope(grant, scope);
    try {
      const result = await fn();
      this.#audit.push(auditEntry(grant, scope, action, detail, true));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      this.#audit.push(auditEntry(grant, scope, action, `${detail} — failed: ${message}`, false));
      throw err;
    }
  }

  /** Log helper that cannot leak a credential. */
  protected log(message: string, context: Record<string, unknown> = {}): void {
    // eslint-disable-next-line no-console
    console.info(`[xactimate:${this.kind}] ${message}`, redact(context));
  }

  drainAudit(): ConsentAuditEntry[] {
    return this.#audit.splice(0, this.#audit.length);
  }

  abstract connect(input: ConnectInput, grant: ConsentGrant): Promise<ConnectResult>;
  abstract fetchPriceLists(
    session: XactimateSession,
    grant: ConsentGrant,
  ): Promise<XactimateProfile['availablePriceLists']>;
  abstract fetchPriceList(
    session: XactimateSession,
    grant: ConsentGrant,
    priceListId: string,
  ): Promise<PriceList>;
  abstract createEstimate(
    session: XactimateSession,
    grant: ConsentGrant,
    estimate: MitigationEstimate,
  ): Promise<EstimateSubmission>;
  abstract addLineItems(
    session: XactimateSession,
    grant: ConsentGrant,
    estimateId: string,
    lineItems: EstimateLineItem[],
  ): Promise<EstimateSubmission>;
  abstract disconnect(session: XactimateSession): Promise<void>;
}
