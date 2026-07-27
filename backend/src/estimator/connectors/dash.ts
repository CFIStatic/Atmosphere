import { VendorHttpClient, VendorError } from './http.js';
import type { CrmConnector, CrmJobQuery } from './ports.js';
import type { ProviderSecret } from '../credentials.js';
import type { CrmJob, CrmJobDocument, CrmJobNote } from '../types.js';

/**
 * Dash connector — reads jobs, their notes, and their attachments.
 *
 * The notes are the point. A scan tells you the geometry of a building; the
 * CRM notes tell you what happened in it, which category of water it was, what
 * the adjuster already approved, and which rooms are out of scope. The matcher
 * and the scope engine both read them, so this connector fetches notes eagerly
 * rather than making them a second round trip.
 *
 * `searchJobs` deliberately runs several narrower queries and merges the
 * results: Dash tenants differ in which fields are indexed, and a single query
 * that returns nothing is indistinguishable from a job that does not exist.
 * Point `DASH_BASE_URL` at the tenant's API root.
 */

export class DashConnector implements CrmConnector {
  readonly name = 'Dash';

  private readonly http: VendorHttpClient;

  constructor(baseUrl: string, secret: ProviderSecret) {
    this.http = new VendorHttpClient({
      vendor: this.name,
      baseUrl,
      authHeaders: () => {
        if (secret.apiKey) {
          return {
            Authorization: `Bearer ${secret.apiKey}`,
            // Multi-company Dash tenants scope every read by company id.
            ...(secret.accountId ? { 'X-Company-Id': secret.accountId } : {}),
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
    await this.http.request<unknown>({ path: '/jobs', query: { limit: 1 } });
  }

  async searchJobs(query: CrmJobQuery): Promise<CrmJob[]> {
    const limit = query.limit ?? 25;

    // Run the available identifiers as separate queries. A claim number match
    // is decisive when it lands, but scans frequently carry only an address.
    const attempts: Record<string, string | undefined>[] = [
      query.claimNumber ? { claimNumber: query.claimNumber } : undefined,
      query.address ? { address: query.address } : undefined,
      query.postalCode ? { postalCode: query.postalCode } : undefined,
      query.insuredName ? { customerName: query.insuredName } : undefined,
    ].filter(Boolean) as Record<string, string | undefined>[];

    if (attempts.length === 0) return [];

    const settled = await Promise.allSettled(
      attempts.map((params) =>
        this.http.request<{ data?: RawJob[]; jobs?: RawJob[] }>({
          path: '/jobs',
          query: { ...params, limit },
        }),
      ),
    );

    // One failing query must not sink the search — a tenant that does not index
    // postal code will 400 on that attempt and still match on claim number.
    const byId = new Map<string, CrmJob>();
    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      for (const raw of result.value.data ?? result.value.jobs ?? []) {
        const job = normaliseJob(raw);
        if (!byId.has(job.id)) byId.set(job.id, job);
      }
    }

    if (byId.size === 0 && settled.every((r) => r.status === 'rejected')) {
      // Every query failed: that is a connector problem, not an empty result.
      const first = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      throw first.reason;
    }

    // Notes drive matching and scoping, so hydrate the candidates we found.
    const candidates = [...byId.values()].slice(0, limit);
    await Promise.all(
      candidates.map(async (job) => {
        if (job.notes.length > 0) return;
        job.notes = await this.listNotes(job.id).catch(() => []);
      }),
    );

    return candidates;
  }

  async getJob(jobId: string): Promise<CrmJob> {
    const raw = await this.http.request<RawJob>({ path: `/jobs/${jobId}` });
    const job = normaliseJob(raw);
    if (job.notes.length === 0) job.notes = await this.listNotes(jobId).catch(() => []);
    if (!job.documents || job.documents.length === 0) {
      job.documents = await this.listDocuments(jobId).catch(() => []);
    }
    return job;
  }

  async downloadDocument(
    jobId: string,
    documentId: string,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    return this.http.fetchBinary({ path: `/jobs/${jobId}/documents/${documentId}/content` });
  }

  private async listNotes(jobId: string): Promise<CrmJobNote[]> {
    const body = await this.http.request<{ data?: RawNote[]; notes?: RawNote[] }>({
      path: `/jobs/${jobId}/notes`,
      query: { limit: 100 },
    });
    return (body.data ?? body.notes ?? []).map(normaliseNote);
  }

  private async listDocuments(jobId: string): Promise<CrmJobDocument[]> {
    const body = await this.http.request<{ data?: RawDocument[]; documents?: RawDocument[] }>({
      path: `/jobs/${jobId}/documents`,
      query: { limit: 100 },
    });
    return (body.data ?? body.documents ?? []).map(normaliseDocument);
  }
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

interface RawJob {
  id?: string | number;
  jobNumber?: string;
  job_number?: string;
  claimNumber?: string;
  claim_number?: string;
  policyNumber?: string;
  policy_number?: string;
  customerName?: string;
  insuredName?: string;
  contactName?: string;
  address?: { street?: string; city?: string; state?: string; postalCode?: string; zip?: string };
  addressLine1?: string;
  city?: string;
  state?: string;
  zip?: string;
  lossType?: string;
  loss_type?: string;
  lossDate?: string;
  loss_date?: string;
  carrier?: string;
  insuranceCompany?: string;
  status?: string;
  notes?: RawNote[];
  documents?: RawDocument[];
}

interface RawNote {
  id?: string | number;
  author?: string;
  createdBy?: string;
  createdAt?: string;
  created_at?: string;
  body?: string;
  text?: string;
  note?: string;
}

interface RawDocument {
  id?: string | number;
  name?: string;
  fileName?: string;
  contentType?: string;
  mimeType?: string;
  url?: string;
  downloadUrl?: string;
}

function normaliseJob(raw: RawJob): CrmJob {
  return {
    id: String(raw.id ?? ''),
    jobNumber: raw.jobNumber ?? raw.job_number,
    claimNumber: raw.claimNumber ?? raw.claim_number,
    policyNumber: raw.policyNumber ?? raw.policy_number,
    insuredName: raw.insuredName ?? raw.customerName ?? raw.contactName,
    address: {
      street: raw.address?.street ?? raw.addressLine1,
      city: raw.address?.city ?? raw.city,
      state: raw.address?.state ?? raw.state,
      postalCode: raw.address?.postalCode ?? raw.address?.zip ?? raw.zip,
    },
    lossType: raw.lossType ?? raw.loss_type,
    lossDate: raw.lossDate ?? raw.loss_date,
    carrier: raw.carrier ?? raw.insuranceCompany,
    status: raw.status,
    notes: (raw.notes ?? []).map(normaliseNote),
    documents: (raw.documents ?? []).map(normaliseDocument),
  };
}

function normaliseNote(raw: RawNote, index: number): CrmJobNote {
  return {
    id: String(raw.id ?? `note-${index + 1}`),
    author: raw.author ?? raw.createdBy,
    createdAt: raw.createdAt ?? raw.created_at,
    body: raw.body ?? raw.text ?? raw.note ?? '',
  };
}

function normaliseDocument(raw: RawDocument, index: number): CrmJobDocument {
  return {
    id: String(raw.id ?? `doc-${index + 1}`),
    name: raw.name ?? raw.fileName ?? `Document ${index + 1}`,
    contentType: raw.contentType ?? raw.mimeType,
    url: raw.downloadUrl ?? raw.url ?? '',
  };
}
