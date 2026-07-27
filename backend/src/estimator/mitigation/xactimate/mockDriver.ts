import { randomUUID, createHash } from 'node:crypto';
import { BaseXactimateDriver, DriverError, type ConnectInput, type ConnectResult, type EstimateSubmission, type XactimateProfile, type XactimateSession } from './driver.js';
import { CATALOG } from '../catalog/lineItems.js';
import { round } from '../lib/geometry.js';
import type { PriceList, PriceListEntry } from '../catalog/priceList.js';
import type { ConsentGrant } from './consent.js';
import type { EstimateLineItem, MitigationEstimate } from '../types.js';

/**
 * A local, deterministic Xactimate stand-in.
 *
 * This is the default driver, and that is a deliberate choice: the estimator has
 * to be fully exercisable — every route, the consent flow, price-list
 * reconciliation, the whole pipeline — without anyone typing a real Xactimate
 * password into a development machine. Nothing here touches the network.
 *
 * The price list it returns is derived from the seed catalog with a stable
 * per-code perturbation, so reconciliation has something real to do: some codes
 * match exactly, some only match by description, and some are absent — which is
 * exactly the mix a real regional price list produces.
 */
export class MockXactimateDriver extends BaseXactimateDriver {
  readonly kind = 'mock' as const;

  /** Set to force the MFA branch, so the UI path can be exercised. */
  constructor(private readonly options: { requireMfa?: boolean } = {}) {
    super();
  }

  async connect(input: ConnectInput, grant: ConsentGrant): Promise<ConnectResult> {
    return this.guard(grant, 'read_profile', 'connect', `sign in as ${input.username}`, async () => {
      if (!input.username || !input.password) {
        return { status: 'failed', code: 'invalid_credentials', message: 'Username and password are required.' } as const;
      }
      if (this.options.requireMfa && !input.mfaCode) {
        return {
          status: 'mfa_required',
          challengeId: randomUUID(),
          message: 'Enter the 6-digit code from your authenticator app.',
        } as const;
      }

      const session: XactimateSession = {
        id: randomUUID(),
        kind: this.kind,
        username: input.username,
        establishedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        handle: { mock: true },
      };

      return {
        status: 'connected',
        session,
        profile: {
          username: input.username,
          displayName: input.username.split('@')[0],
          companyName: 'Demo Restoration Co.',
          availablePriceLists: MOCK_PRICE_LISTS,
        } satisfies XactimateProfile,
      } as const;
    });
  }

  async fetchPriceLists(session: XactimateSession, grant: ConsentGrant) {
    return this.guard(grant, 'read_price_list', 'fetch_price_lists', `for ${session.username}`, async () =>
      MOCK_PRICE_LISTS,
    );
  }

  async fetchPriceList(
    _session: XactimateSession,
    grant: ConsentGrant,
    priceListId: string,
  ): Promise<PriceList> {
    return this.guard(grant, 'read_price_list', 'fetch_price_list', priceListId, async () => {
      const summary = MOCK_PRICE_LISTS.find((list) => list.id === priceListId);
      if (!summary) throw new DriverError(`No price list "${priceListId}" on this account.`, 'price_list_not_found');
      return buildMockPriceList(summary);
    });
  }

  async createEstimate(
    _session: XactimateSession,
    grant: ConsentGrant,
    estimate: MitigationEstimate,
  ): Promise<EstimateSubmission> {
    return this.guard(
      grant,
      'write_estimate',
      'create_estimate',
      `job ${estimate.jobId} with ${estimate.lineItems.length} lines`,
      async () => {
        const estimateId = `MOCK-${estimate.jobId.slice(0, 8).toUpperCase()}`;
        this.log('created estimate', { estimateId, lines: estimate.lineItems.length });
        return {
          estimateId,
          url: `https://xactimate.example/estimates/${estimateId}`,
          lineItemsWritten: estimate.lineItems.length,
          warnings: estimate.lineItems.some((line) => !line.priceVerified)
            ? ['Some lines were written with placeholder prices — sync a price list before submitting.']
            : [],
        };
      },
    );
  }

  async addLineItems(
    _session: XactimateSession,
    grant: ConsentGrant,
    estimateId: string,
    lineItems: EstimateLineItem[],
  ): Promise<EstimateSubmission> {
    return this.guard(
      grant,
      'write_estimate',
      'add_line_items',
      `${lineItems.length} lines to ${estimateId}`,
      async () => ({
        estimateId,
        lineItemsWritten: lineItems.length,
        warnings: [],
      }),
    );
  }

  async disconnect(): Promise<void> {
    /* nothing to tear down */
  }
}

/* ------------------------------------------------------------------ *
 * Mock price-list data
 * ------------------------------------------------------------------ */

const MOCK_PRICE_LISTS = [
  { id: 'DEMO8X_JAN26', name: 'Demo Region — January 2026', effectiveDate: '2026-01-01' },
  { id: 'DEMO8X_OCT25', name: 'Demo Region — October 2025', effectiveDate: '2025-10-01' },
];

/**
 * Build a price list from the seed catalog.
 *
 * Three deliberate distortions make reconciliation meaningful rather than a
 * no-op: prices are perturbed by a stable ±12% derived from the code, roughly
 * one code in seven is renamed so only the description matches, and one in
 * eleven is dropped so the "unmatched" path is exercised.
 */
function buildMockPriceList(summary: { id: string; name: string; effectiveDate?: string }): PriceList {
  const entries: PriceListEntry[] = [];

  for (const item of CATALOG) {
    const bucket = stableBucket(item.code);
    if (bucket % 11 === 0) continue; // absent from this region's list

    const drift = 1 + ((bucket % 25) - 12) / 100; // ±12%
    const olderList = summary.id.endsWith('OCT25') ? 0.96 : 1;

    entries.push({
      code: bucket % 7 === 0 ? `${item.code}X` : item.code, // renamed selector
      description: item.description,
      unit: item.unit,
      unitPrice: round(item.defaultUnitPrice * drift * olderList),
    });
  }

  return { id: summary.id, name: summary.name, effectiveDate: summary.effectiveDate, entries };
}

/** Deterministic 0–255 bucket for a code, so the mock never shifts between runs. */
function stableBucket(code: string): number {
  return createHash('sha256').update(code).digest()[0];
}
