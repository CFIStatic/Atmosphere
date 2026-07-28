import { config } from '../../../config.js';
import type { CarrierId, ProgramAgreement, ProgramId, SlaRule } from './types.js';

/**
 * Where program agreements come from.
 *
 * Three sources, mirroring the Xactimate driver split, and for the same reason:
 * which one an org can use depends on their access, not on anything this
 * codebase controls.
 *
 *   `manual` — someone reads the agreement and enters its terms once. Works
 *              everywhere, needs no credentials, and is the only source that is
 *              guaranteed to reflect what the franchise actually signed.
 *   `portal` — pulled from the franchisor's contractor portal over HTTP.
 *              Requires a documented endpoint and credentials the org supplies.
 *   `mock`   — a representative agreement for development and demos.
 *
 * ## What is deliberately not built here
 *
 * There is no browser scraper for the franchisor portal, and that is a decision
 * rather than an omission.
 *
 * A program agreement is a contract. Its terms decide what a franchise may bill
 * and what it will be charged back for. A scraper written against a portal whose
 * markup nobody here has seen would not fail loudly when the page changed — it
 * would return *plausible* terms, and an estimate built on a plausible-but-wrong
 * equipment cap is worse than one built on no cap at all, because it is trusted.
 * The failure would surface weeks later as a chargeback, and it would be
 * invisible in the meantime.
 *
 * So: the portal adapter speaks a documented JSON contract that a franchisor
 * endpoint (or a small internal shim in front of one) can serve, and everything
 * else goes through `manual`. If ServiceMaster or another franchisor publishes a
 * real API, pointing `SLA_PORTAL_BASE_URL` at it and mapping its payload in
 * `parseAgreement` is the whole integration.
 */

export type SlaSourceKind = 'manual' | 'portal' | 'mock';

export interface SlaLookup {
  carrierId: CarrierId;
  programId?: ProgramId | null;
}

export interface SlaSource {
  readonly kind: SlaSourceKind;
  fetchAgreement(lookup: SlaLookup): Promise<ProgramAgreement | null>;
}

export class SlaSourceError extends Error {
  readonly code: string;
  constructor(message: string, code = 'sla_source_error') {
    super(message);
    this.name = 'SlaSourceError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ *
 * Portal
 * ------------------------------------------------------------------ */

const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Pulls an agreement from a franchisor contractor portal.
 *
 * The expected response is the documented shape below. Anything else is a hard
 * error rather than a best-effort parse — half-understood contract terms are the
 * one thing this module must never produce.
 *
 * ```json
 * {
 *   "carrier":  { "id": "state_farm", "name": "State Farm" },
 *   "program":  { "id": "contractor_connection", "name": "Contractor Connection" },
 *   "version":  "2026.1",
 *   "effectiveFrom": "2026-01-01",
 *   "rules": [
 *     { "id": "pl", "title": "Price list", "summary": "…", "severity": "hard",
 *       "sourceRef": "Exhibit B §2", "constraint": { "kind": "price_list", "priceListId": "FLMI8X_JAN26" } }
 *   ]
 * }
 * ```
 */
export class PortalSlaSource implements SlaSource {
  readonly kind = 'portal' as const;

  constructor(
    private readonly baseUrl = config.sla.portalBaseUrl,
    private readonly apiKey = config.sla.portalApiKey,
  ) {
    if (!this.baseUrl) {
      throw new SlaSourceError(
        'No contractor-portal endpoint is configured. Set SLA_PORTAL_BASE_URL, or enter the program terms by hand — which is the only source guaranteed to match what your franchise actually signed.',
        'portal_not_configured',
      );
    }
  }

  async fetchAgreement(lookup: SlaLookup): Promise<ProgramAgreement | null> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, '')}/agreements`);
    url.searchParams.set('carrier', lookup.carrierId);
    if (lookup.programId) url.searchParams.set('program', lookup.programId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
      });

      if (response.status === 404) return null;
      if (response.status === 401 || response.status === 403) {
        throw new SlaSourceError(
          'The contractor portal refused the request. Check the configured credentials and that this franchise is entitled to the program.',
          'portal_unauthorized',
        );
      }
      if (!response.ok) {
        throw new SlaSourceError(`The contractor portal returned ${response.status}.`, 'portal_error');
      }

      const payload: unknown = await response.json();
      return parseAgreement(payload, { kind: 'portal', reference: url.toString() });
    } catch (err) {
      if (err instanceof SlaSourceError) throw err;
      throw new SlaSourceError(
        `Could not reach the contractor portal: ${err instanceof Error ? err.message : 'unknown error'}. Enter the terms by hand rather than submitting without them.`,
        'portal_unreachable',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONSTRAINT_KINDS = new Set([
  'price_list',
  'overhead_and_profit',
  'rate_concession',
  'max_quantity',
  'max_equipment_days',
  'approval_threshold',
  'line_item_prohibited',
  'required_documentation',
  'timeline',
  'invoice_window',
]);

/**
 * Turn a payload into an agreement, or refuse.
 *
 * Unknown constraint kinds are dropped **and counted**, never coerced. A term
 * this build does not understand is a term it cannot enforce, and the caller is
 * told how many were skipped so nobody believes the estimate was checked against
 * the full agreement when it was not.
 */
export function parseAgreement(
  payload: unknown,
  source: { kind: 'manual' | 'portal' | 'mock'; reference?: string; enteredBy?: string },
): ProgramAgreement {
  const root = payload as any;
  if (!root || typeof root !== 'object') {
    throw new SlaSourceError('The agreement payload was not an object.', 'bad_agreement');
  }

  const carrierId = str(root.carrier?.id ?? root.carrierId);
  const programId = str(root.program?.id ?? root.programId);
  if (!carrierId || !programId) {
    throw new SlaSourceError(
      'The agreement payload is missing its carrier or program id. Both are required — an agreement that cannot be attributed cannot be applied.',
      'bad_agreement',
    );
  }

  const rawRules = Array.isArray(root.rules) ? root.rules : [];
  const rules: SlaRule[] = [];
  const skipped: string[] = [];

  for (const raw of rawRules) {
    const kind = str(raw?.constraint?.kind);
    if (!kind || !CONSTRAINT_KINDS.has(kind)) {
      skipped.push(kind ?? '(no kind)');
      continue;
    }
    const id = str(raw.id) ?? `rule-${rules.length + 1}`;
    rules.push({
      id,
      title: str(raw.title) ?? id,
      summary: str(raw.summary) ?? '',
      // Terms default to `hard`. If the payload does not say how binding a term
      // is, treating it as advisory is the expensive direction to be wrong in.
      severity: raw.severity === 'soft' ? 'soft' : 'hard',
      sourceRef: str(raw.sourceRef),
      constraint: raw.constraint,
    });
  }

  if (skipped.length > 0) {
    // Not thrown: a partially-understood agreement is still worth applying, so
    // long as nobody is left thinking it was applied whole.
    // eslint-disable-next-line no-console
    console.warn(
      `[sla] ${skipped.length} term(s) in the ${programId} agreement use constraint kinds this build does not understand (${skipped.join(', ')}) and were not checked.`,
    );
  }

  return {
    carrierId,
    carrierName: str(root.carrier?.name ?? root.carrierName) ?? carrierId,
    programId,
    programName: str(root.program?.name ?? root.programName) ?? programId,
    version: str(root.version) ?? 'unversioned',
    effectiveFrom: str(root.effectiveFrom),
    effectiveTo: str(root.effectiveTo),
    rules,
    source: { ...source, retrievedAt: new Date().toISOString() },
  };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** True when the agreement is in force today. */
export function isInForce(agreement: ProgramAgreement, at = new Date()): boolean {
  const now = at.getTime();
  if (agreement.effectiveFrom && Date.parse(agreement.effectiveFrom) > now) return false;
  if (agreement.effectiveTo && Date.parse(agreement.effectiveTo) < now) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Mock
 * ------------------------------------------------------------------ */

/**
 * A representative national-account agreement.
 *
 * Shaped like the terms restoration programs actually carry — a mandated price
 * list, no overhead and profit, a modest concession, an equipment allowance, an
 * approval threshold, documentation requirements and a response-time clause — so
 * the enforcement paths are exercisable without anyone uploading a real
 * contract. The numbers are illustrative and match no real programme.
 */
export const MOCK_AGREEMENT_RULES: SlaRule[] = [
  {
    id: 'price-list',
    title: 'Program price list',
    summary: 'Estimates are written on the program-designated regional price list current at the date of loss.',
    severity: 'hard',
    sourceRef: 'Exhibit B §2.1',
    constraint: { kind: 'price_list', priceListId: 'DEMO8X_JAN26' },
  },
  {
    id: 'no-oandp',
    title: 'Overhead and profit',
    summary: 'Mitigation-only assignments are not eligible for general contractor overhead and profit.',
    severity: 'hard',
    sourceRef: 'Exhibit B §3.4',
    constraint: { kind: 'overhead_and_profit', allowed: false },
  },
  {
    id: 'concession',
    title: 'Program rate concession',
    summary: 'A negotiated concession applies to all water mitigation line items.',
    severity: 'soft',
    sourceRef: 'Exhibit B §2.6',
    constraint: { kind: 'rate_concession', discountPct: 0.05, categories: ['WTR'] },
  },
  {
    id: 'equipment-days',
    title: 'Drying equipment allowance',
    summary: 'Up to three days of drying equipment without prior authorisation; beyond that requires written approval supported by moisture documentation.',
    severity: 'hard',
    sourceRef: 'Exhibit C §1.2',
    constraint: { kind: 'max_equipment_days', maxDays: 3 },
  },
  {
    id: 'approval-threshold',
    title: 'Pre-approval threshold',
    summary: 'Estimates above the threshold require written approval before work proceeds.',
    severity: 'hard',
    sourceRef: 'Exhibit A §5',
    constraint: { kind: 'approval_threshold', amount: 5000 },
  },
  {
    id: 'documentation',
    title: 'Required documentation',
    summary: 'Every submission carries before and after photographs, the moisture log, psychrometric readings and the daily monitoring record.',
    severity: 'hard',
    sourceRef: 'Exhibit D §1',
    constraint: {
      kind: 'required_documentation',
      items: ['before photos', 'after photos', 'moisture log', 'psychrometric readings', 'daily monitoring record'],
    },
  },
  {
    id: 'response-time',
    title: 'Response time',
    summary: 'The contractor is on site within 24 hours of first notice of loss.',
    severity: 'soft',
    sourceRef: 'Exhibit A §2.1',
    constraint: { kind: 'timeline', milestone: 'on_site', withinHours: 24 },
  },
  {
    id: 'invoice-window',
    title: 'Invoice submission',
    summary: 'Invoices are submitted within fourteen days of completion.',
    severity: 'soft',
    sourceRef: 'Exhibit A §7.3',
    constraint: { kind: 'invoice_window', withinDays: 14 },
  },
];

export class MockSlaSource implements SlaSource {
  readonly kind = 'mock' as const;

  async fetchAgreement(lookup: SlaLookup): Promise<ProgramAgreement | null> {
    return {
      carrierId: lookup.carrierId,
      carrierName: lookup.carrierId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      programId: lookup.programId ?? 'contractor_connection',
      programName: 'Contractor Connection (demo terms)',
      version: 'demo-2026.1',
      effectiveFrom: '2026-01-01',
      rules: MOCK_AGREEMENT_RULES,
      source: {
        kind: 'mock',
        reference: 'built-in demo agreement — not a real program contract',
        retrievedAt: new Date().toISOString(),
      },
    };
  }
}

/**
 * Reads agreements an org entered by hand.
 *
 * Backed by whatever loader the caller supplies, so the store layer can provide
 * the database read without this module knowing about Supabase.
 */
export class ManualSlaSource implements SlaSource {
  readonly kind = 'manual' as const;

  constructor(private readonly load: (lookup: SlaLookup) => Promise<ProgramAgreement | null>) {}

  fetchAgreement(lookup: SlaLookup): Promise<ProgramAgreement | null> {
    return this.load(lookup);
  }
}

/**
 * Resolve an agreement, preferring what the org entered over what a portal
 * serves.
 *
 * That precedence is deliberate. A hand-entered agreement was read by someone at
 * the franchise who is accountable for it; a portal response is a system's
 * opinion. When both exist and disagree, the human wins.
 */
export async function resolveAgreement(
  lookup: SlaLookup,
  sources: SlaSource[],
): Promise<{ agreement: ProgramAgreement | null; errors: string[] }> {
  const errors: string[] = [];

  for (const source of sources) {
    try {
      const agreement = await source.fetchAgreement(lookup);
      if (!agreement) continue;
      if (!isInForce(agreement)) {
        errors.push(
          `The ${source.kind} agreement for ${agreement.programName} (${agreement.version}) is outside its effective dates and was not applied.`,
        );
        continue;
      }
      return { agreement, errors };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `The ${source.kind} agreement source failed.`);
    }
  }

  return { agreement: null, errors };
}
