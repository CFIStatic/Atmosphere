import { randomUUID } from 'node:crypto';
import { config } from '../../../config.js';
import {
  BaseXactimateDriver,
  DriverError,
  type ConnectInput,
  type ConnectResult,
  type EstimateSubmission,
  type XactimateProfile,
  type XactimateSession,
} from './driver.js';
import type { PriceList, PriceListEntry } from '../catalog/priceList.js';
import type { ConsentGrant } from './consent.js';
import type { EstimateLineItem, MitigationEstimate } from '../types.js';

/**
 * Xactimate over Verisk's partner API.
 *
 * This is the driver to use if the org has an integration agreement — it is
 * supported, it survives UI changes, and it never replays a password. Endpoint
 * paths and the token grant differ per agreement, so they are configuration
 * (`XACTIMATE_API_BASE_URL`, `XACTIMATE_API_KEY`) rather than constants, and the
 * driver refuses to start rather than guessing at them.
 *
 * The request/response shapes below follow the conventional XactAnalysis pattern
 * (bearer token, JSON envelopes, `X-Api-Key` on every call). Where a specific
 * agreement differs, the mapping functions at the bottom of this file are the
 * only things that need to change.
 */

interface ApiHandle {
  accessToken: string;
  refreshToken?: string;
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

export class XactimateApiDriver extends BaseXactimateDriver {
  readonly kind = 'api' as const;

  constructor(
    private readonly baseUrl = config.xactimate.apiBaseUrl,
    private readonly apiKey = config.xactimate.apiKey,
  ) {
    super();
    if (!this.baseUrl || !this.apiKey) {
      throw new DriverError(
        'The Xactimate API driver needs XACTIMATE_API_BASE_URL and XACTIMATE_API_KEY. Without an integration agreement, use the web driver or file export instead.',
        'api_not_configured',
      );
    }
  }

  async connect(input: ConnectInput, grant: ConsentGrant): Promise<ConnectResult> {
    return this.guard(grant, 'read_profile', 'connect', `api sign-in as ${input.username}`, async () => {
      const response = await this.request<{
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        mfa_required?: boolean;
        challenge_id?: string;
        profile?: Record<string, unknown>;
      }>('POST', '/auth/token', {
        body: {
          grant_type: 'password',
          username: input.username,
          password: input.password,
          ...(input.mfaCode ? { mfa_code: input.mfaCode } : {}),
        },
      });

      if (response.mfa_required) {
        return {
          status: 'mfa_required',
          challengeId: response.challenge_id ?? randomUUID(),
          message: 'Xactimate asked for a second factor. Enter the code from your authenticator.',
        } as const;
      }

      if (!response.access_token) {
        return {
          status: 'failed',
          code: 'invalid_credentials',
          message: 'Xactimate rejected those credentials.',
        } as const;
      }

      const ttlMs = (response.expires_in ?? 3600) * 1000;
      const session: XactimateSession = {
        id: randomUUID(),
        kind: this.kind,
        username: input.username,
        establishedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        handle: { accessToken: response.access_token, refreshToken: response.refresh_token } satisfies ApiHandle,
      };

      const priceLists = await this.listPriceLists(session);

      return {
        status: 'connected',
        session,
        profile: {
          username: input.username,
          displayName: str(response.profile?.name) ?? input.username,
          companyName: str(response.profile?.company),
          availablePriceLists: priceLists,
        } satisfies XactimateProfile,
      } as const;
    });
  }

  async fetchPriceLists(session: XactimateSession, grant: ConsentGrant) {
    return this.guard(grant, 'read_price_list', 'fetch_price_lists', session.username, async () =>
      this.listPriceLists(session),
    );
  }

  async fetchPriceList(
    session: XactimateSession,
    grant: ConsentGrant,
    priceListId: string,
  ): Promise<PriceList> {
    return this.guard(grant, 'read_price_list', 'fetch_price_list', priceListId, async () => {
      const payload = await this.request<{
        id?: string;
        name?: string;
        effective_date?: string;
        items?: unknown[];
      }>('GET', `/price-lists/${encodeURIComponent(priceListId)}`, { session });

      return {
        id: payload.id ?? priceListId,
        name: payload.name ?? priceListId,
        effectiveDate: payload.effective_date,
        entries: (payload.items ?? []).map(toPriceListEntry).filter((e): e is PriceListEntry => e !== null),
      };
    });
  }

  async createEstimate(
    session: XactimateSession,
    grant: ConsentGrant,
    estimate: MitigationEstimate,
  ): Promise<EstimateSubmission> {
    return this.guard(
      grant,
      'write_estimate',
      'create_estimate',
      `job ${estimate.jobId}, ${estimate.lineItems.length} lines`,
      async () => {
        const payload = await this.request<{ id?: string; url?: string; warnings?: string[] }>(
          'POST',
          '/estimates',
          { session, body: toEstimatePayload(estimate) },
        );

        if (!payload.id) throw new DriverError('Xactimate accepted the request but returned no estimate id.', 'no_estimate_id');

        return {
          estimateId: payload.id,
          url: payload.url,
          lineItemsWritten: estimate.lineItems.length,
          warnings: payload.warnings ?? [],
        };
      },
    );
  }

  async addLineItems(
    session: XactimateSession,
    grant: ConsentGrant,
    estimateId: string,
    lineItems: EstimateLineItem[],
  ): Promise<EstimateSubmission> {
    return this.guard(
      grant,
      'write_estimate',
      'add_line_items',
      `${lineItems.length} lines to ${estimateId}`,
      async () => {
        const payload = await this.request<{ written?: number; warnings?: string[] }>(
          'POST',
          `/estimates/${encodeURIComponent(estimateId)}/line-items`,
          { session, body: { items: lineItems.map(toLineItemPayload) } },
        );
        return {
          estimateId,
          lineItemsWritten: payload.written ?? lineItems.length,
          warnings: payload.warnings ?? [],
        };
      },
    );
  }

  async disconnect(session: XactimateSession): Promise<void> {
    try {
      await this.request('POST', '/auth/revoke', { session });
    } catch {
      // A failed revoke must not block sign-out; the token expires on its own.
    }
  }

  /* ---- HTTP ---- */

  private async listPriceLists(session: XactimateSession) {
    const payload = await this.request<{ price_lists?: Array<Record<string, unknown>> }>(
      'GET',
      '/price-lists',
      { session },
    );
    return (payload.price_lists ?? []).map((row) => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? row.id ?? ''),
      effectiveDate: str(row.effective_date),
    }));
  }

  /**
   * One HTTP call, with a bounded retry.
   *
   * Only 429 and 5xx are retried, with exponential backoff — retrying a 401
   * against a login endpoint is how an account gets locked out, which for a
   * restoration company mid-job is a genuinely expensive failure.
   */
  private async request<T>(
    method: string,
    path: string,
    options: { session?: XactimateSession; body?: unknown } = {},
  ): Promise<T> {
    const url = `${this.baseUrl.replace(/\/$/, '')}${path}`;
    const handle = options.session?.handle as ApiHandle | undefined;

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          method,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Api-Key': this.apiKey,
            ...(handle?.accessToken ? { Authorization: `Bearer ${handle.accessToken}` } : {}),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });

        if (response.status === 429 || response.status >= 500) {
          throw new DriverError(
            `Xactimate returned ${response.status}.`,
            response.status === 429 ? 'rate_limited' : 'upstream_error',
            true,
          );
        }

        if (response.status === 401 || response.status === 403) {
          throw new DriverError(
            'Xactimate refused the request. The session may have expired, or the account lacks permission for this action.',
            'xactimate_unauthorized',
          );
        }

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new DriverError(
            `Xactimate rejected the request (${response.status}). ${detail.slice(0, 200)}`,
            'xactimate_bad_request',
          );
        }

        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const retryable = err instanceof DriverError ? err.retryable : isNetworkError(lastError);
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        await sleep(2 ** attempt * 500);
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new DriverError('Xactimate request failed.', 'xactimate_error');
  }
}

/* ------------------------------------------------------------------ *
 * Payload mapping — the only part that differs per agreement
 * ------------------------------------------------------------------ */

function toEstimatePayload(estimate: MitigationEstimate) {
  const { assessment } = estimate;
  return {
    claim_number: assessment.claimNumber,
    carrier: assessment.carrier,
    insured_name: assessment.insuredName,
    loss_address: assessment.propertyAddress,
    date_of_loss: assessment.dateOfLoss,
    type_of_loss: 'WATER',
    notes: estimate.narrative,
    rooms: assessment.rooms.map((room) => ({
      name: room.name,
      level: room.level,
      length_ft: room.geometry.lengthFt,
      width_ft: room.geometry.widthFt,
      height_ft: room.geometry.heightFt,
      floor_sf: room.geometry.floorSF,
      wall_sf: room.geometry.wallSF,
      ceiling_sf: room.geometry.ceilingSF,
      perimeter_lf: room.geometry.perimeterLF,
    })),
    line_items: estimate.lineItems.map(toLineItemPayload),
  };
}

function toLineItemPayload(line: EstimateLineItem) {
  return {
    selector: line.code,
    category: line.category,
    description: line.description,
    room: line.roomName,
    quantity: line.quantity,
    unit: line.unit,
    unit_price: line.unitPrice,
    note: line.justification,
  };
}

function toPriceListEntry(raw: unknown): PriceListEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const code = str(row.code ?? row.selector);
  const unitPrice = Number(row.unit_price ?? row.price);
  if (!code || !Number.isFinite(unitPrice)) return null;

  return {
    code,
    description: str(row.description) ?? code,
    unit: str(row.unit) ?? 'EA',
    unitPrice,
    laborPrice: numOrUndefined(row.labor_price),
    materialPrice: numOrUndefined(row.material_price),
    equipmentPrice: numOrUndefined(row.equipment_price),
  };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isNetworkError(err: Error): boolean {
  return /fetch failed|network|ECONN|ETIMEDOUT|abort/i.test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
