import { VendorHttpClient, VendorError } from './http.js';
import type { EstimateConnector } from './ports.js';
import type { ProviderSecret } from '../credentials.js';
import { toXactimateXml } from '../estimate/export.js';
import { parseMitigationEstimate } from '../estimate/mitigationImport.js';
import type { ConstructionEstimate, MitigationEstimate } from '../types.js';

/**
 * Xactimate connector — the write side of the pipeline, and the only step that
 * changes anything outside Atmosphere.
 *
 * Estimates are posted as the line-item interchange document produced by
 * `estimate/export.ts` (Xactimate's `.esx` is a proprietary binary container;
 * the interchange XML is the supported way in). The same host also serves the
 * mitigation estimate for a claim, which is how a rebuild gets built when the
 * CRM has no copy of it attached.
 *
 * `createEstimate` is marked non-idempotent: a retry after a timeout would
 * create a second estimate on the claim, which is worse than a visible failure
 * the operator can retry deliberately.
 */

export class XactimateConnector implements EstimateConnector {
  readonly name = 'Xactimate';

  private readonly http: VendorHttpClient;
  private readonly accountId?: string;

  constructor(baseUrl: string, secret: ProviderSecret) {
    this.accountId = secret.accountId;
    this.http = new VendorHttpClient({
      vendor: this.name,
      baseUrl,
      authHeaders: () => {
        if (secret.apiKey) {
          return {
            Authorization: `Bearer ${secret.apiKey}`,
            ...(secret.accountId ? { 'X-Account-Id': secret.accountId } : {}),
          };
        }
        if (secret.username && secret.password) {
          const basic = Buffer.from(`${secret.username}:${secret.password}`).toString('base64');
          return { Authorization: `Basic ${basic}` };
        }
        throw new VendorError(this.name, 401, 'no credentials stored', false);
      },
    });
  }

  async verify(): Promise<void> {
    await this.http.request<unknown>({ path: '/estimates', query: { limit: 1 } });
  }

  async createEstimate(estimate: ConstructionEstimate): Promise<{ reference: string; url?: string }> {
    const response = await this.http.request<{ id?: string; reference?: string; url?: string }>({
      method: 'POST',
      path: '/estimates',
      headers: { 'Content-Type': 'application/json' },
      body: {
        accountId: this.accountId,
        claimNumber: estimate.claimNumber,
        jobNumber: estimate.jobNumber,
        insuredName: estimate.insuredName,
        address: estimate.address,
        // Sent as a document rather than a JSON tree so the payload is byte
        // identical to what the operator can download and inspect.
        format: 'xml',
        document: toXactimateXml(estimate),
      },
      // Creating an estimate twice on one claim is a worse outcome than a
      // failure the operator can see and retry.
      idempotent: false,
      timeoutMs: 60_000,
    });

    const reference = response.reference ?? response.id;
    if (!reference) {
      throw new VendorError(this.name, 502, 'estimate was accepted but no reference was returned', false);
    }
    return { reference, url: response.url };
  }

  async fetchMitigationEstimate(claimNumber: string): Promise<MitigationEstimate | null> {
    const list = await this.http.request<{ data?: RawEstimateSummary[]; estimates?: RawEstimateSummary[] }>({
      path: '/estimates',
      query: { claimNumber, type: 'mitigation', limit: 5 },
    });

    const candidates = list.data ?? list.estimates ?? [];
    // Prefer the most recent mitigation estimate: a re-issued one supersedes
    // whatever was written first.
    const chosen = candidates
      .slice()
      .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0];
    if (!chosen?.id) return null;

    const { bytes, contentType } = await this.http.fetchBinary({
      path: `/estimates/${chosen.id}/export`,
      query: { format: 'csv' },
    });

    return parseMitigationEstimate(bytes.toString('utf8'), {
      source: `Xactimate estimate ${chosen.id}`,
      format: contentType.includes('xml') ? 'xml' : 'auto',
    });
  }
}

interface RawEstimateSummary {
  id?: string;
  updatedAt?: string;
}
