import { config } from '../../../config.js';
import { VendorHttpClient, VendorError } from '../../connectors/http.js';
import { SAMPLE_MICA } from '../fixtures/sampleJob.js';
import { dryingReportsFromMicaExport } from './fromMica.js';
import {
  dryingReportsFromOutlookMessage,
  dryingReportsFromOutlookPayload,
  type OutlookDryingMessage,
} from './fromOutlook.js';
import type { DryingReport } from '../planning/dryingProgress.js';

/**
 * Capture connectors — pull drying progress from the apps crews already use.
 *
 *   MICA Dash  → structured drying export (moisture, psychro, equipment, visits)
 *   Outlook    → emailed daily drying reports (Graph mail or forwarded payload)
 *
 * Live mode talks to configured hosts with API keys from the environment.
 * Sandbox mode returns deterministic fixtures so sync + auto-rebuild can be
 * exercised without vendor credentials.
 */

export type CaptureSourceKind = 'mica_dash' | 'outlook';

export interface CapturePullQuery {
  /** Atmosphere external job id. */
  jobId: string;
  claimNumber?: string;
  /** Only return messages/exports newer than this ISO timestamp. */
  since?: string;
  /** Max messages to pull from Outlook. */
  limit?: number;
}

export interface CapturePullResult {
  source: CaptureSourceKind;
  reports: DryingReport[];
  /** Full MICA payload when pulled — stored so rebuilds keep the latest log. */
  micaPayload?: unknown;
  claimNumber?: string;
  warnings: string[];
  /** How the payload was obtained. */
  mode: 'live' | 'sandbox' | 'payload';
}

export interface DryingCaptureConnector {
  readonly kind: CaptureSourceKind;
  readonly name: string;
  verify(): Promise<void>;
  pull(query: CapturePullQuery): Promise<CapturePullResult>;
}

export function captureMode(): 'live' | 'sandbox' {
  return config.estimator.connectorMode === 'live' ? 'live' : 'sandbox';
}

export function buildCaptureConnectors(options?: {
  micaApiKey?: string;
  outlookAccessToken?: string;
}): DryingCaptureConnector[] {
  const mode = captureMode();
  return [
    mode === 'live' && (options?.micaApiKey || config.estimator.micaDashApiKey)
      ? new LiveMicaDashConnector(options?.micaApiKey ?? config.estimator.micaDashApiKey)
      : new SandboxMicaDashConnector(),
    mode === 'live' && (options?.outlookAccessToken || config.estimator.outlookAccessToken)
      ? new LiveOutlookConnector(options?.outlookAccessToken ?? config.estimator.outlookAccessToken)
      : new SandboxOutlookConnector(),
  ];
}

export function connectorFor(
  kind: CaptureSourceKind,
  options?: { micaApiKey?: string; outlookAccessToken?: string },
): DryingCaptureConnector {
  const all = buildCaptureConnectors(options);
  const found = all.find((c) => c.kind === kind);
  if (!found) throw new Error(`No capture connector for ${kind}`);
  return found;
}

/** Import from an already-fetched payload (webhook, file upload, Graph push). */
export function importCapturePayload(
  kind: CaptureSourceKind,
  payload: unknown,
  query: Partial<CapturePullQuery> = {},
): CapturePullResult {
  if (kind === 'mica_dash') {
    const reports = dryingReportsFromMicaExport(payload, { claimNumber: query.claimNumber });
    return {
      source: kind,
      reports,
      micaPayload: payload,
      claimNumber: query.claimNumber,
      warnings: reports.length ? [] : ['MICA payload produced no drying visits.'],
      mode: 'payload',
    };
  }

  const parsed = dryingReportsFromOutlookPayload(payload);
  return {
    source: kind,
    reports: parsed.reports,
    claimNumber: parsed.claimNumber ?? query.claimNumber,
    warnings: parsed.warnings,
    mode: 'payload',
  };
}

/* ------------------------------------------------------------------ */
/* MICA Dash                                                           */
/* ------------------------------------------------------------------ */

class SandboxMicaDashConnector implements DryingCaptureConnector {
  readonly kind = 'mica_dash' as const;
  readonly name = 'MICA Dash (sandbox)';

  async verify(): Promise<void> {
    return;
  }

  async pull(query: CapturePullQuery): Promise<CapturePullResult> {
    const payload = {
      ...SAMPLE_MICA,
      job: {
        ...SAMPLE_MICA.job,
        claimNumber: query.claimNumber ?? SAMPLE_MICA.job.claimNumber,
      },
    };
    const reports = dryingReportsFromMicaExport(payload, {
      claimNumber: query.claimNumber ?? SAMPLE_MICA.job.claimNumber,
    });
    const filtered = query.since
      ? reports.filter((r) => Date.parse(r.takenAt) > Date.parse(query.since!))
      : reports;
    return {
      source: this.kind,
      reports: filtered,
      micaPayload: payload,
      claimNumber: query.claimNumber ?? SAMPLE_MICA.job.claimNumber,
      warnings: [],
      mode: 'sandbox',
    };
  }
}

class LiveMicaDashConnector implements DryingCaptureConnector {
  readonly kind = 'mica_dash' as const;
  readonly name = 'MICA Dash';
  private readonly http: VendorHttpClient;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    const baseUrl = config.estimator.micaDashBaseUrl;
    if (!baseUrl) {
      throw new VendorError(this.name, 0, 'MICA_DASH_BASE_URL is not configured', false);
    }
    this.http = new VendorHttpClient({
      vendor: this.name,
      baseUrl,
      authHeaders: () => ({ Authorization: `Bearer ${this.apiKey}` }),
    });
  }

  async verify(): Promise<void> {
    await this.http.request({ path: '/health', method: 'GET', idempotent: true });
  }

  async pull(query: CapturePullQuery): Promise<CapturePullResult> {
    const claim = query.claimNumber ?? query.jobId;
    const payload = await this.http.request<unknown>({
      path: `/jobs/${encodeURIComponent(claim)}/export`,
      method: 'GET',
      query: query.since ? { since: query.since } : undefined,
      idempotent: true,
    });
    const reports = dryingReportsFromMicaExport(payload, { claimNumber: claim });
    return {
      source: this.kind,
      reports,
      micaPayload: payload,
      claimNumber: claim,
      warnings: [],
      mode: 'live',
    };
  }
}

/* ------------------------------------------------------------------ */
/* Outlook                                                             */
/* ------------------------------------------------------------------ */

const SANDBOX_OUTLOOK_MESSAGES: OutlookDryingMessage[] = [
  {
    id: 'sandbox-outlook-day3',
    subject: 'Drying Report — FL-2026-0417839 Day 3',
    receivedAt: '2026-06-19T09:15:00Z',
    from: 'tech@restoration.example',
    body: `Claim: FL-2026-0417839
Drying report Day 3 — 2026-06-19

Affected: 84°F / 38% RH / 58 GPP
Unaffected: 77°F / 52% RH / 72 GPP

Kitchen drywall 11% (goal 12)
Dining carpet 9% (goal 10)
Hall engineered wood 8% (goal 9)

Still wet: Kitchen
At dry standard: Dining Room, Hallway

Equipment on site: 15 air movers, 3 LGR, 1 scrubber
`,
  },
];

class SandboxOutlookConnector implements DryingCaptureConnector {
  readonly kind = 'outlook' as const;
  readonly name = 'Outlook drying reports (sandbox)';

  async verify(): Promise<void> {
    return;
  }

  async pull(query: CapturePullQuery): Promise<CapturePullResult> {
    const messages = SANDBOX_OUTLOOK_MESSAGES.filter((m) => {
      if (query.since && m.receivedAt && Date.parse(m.receivedAt) <= Date.parse(query.since)) {
        return false;
      }
      if (query.claimNumber && m.subject && !m.subject.includes(query.claimNumber)) {
        // Still allow sandbox demo when claim matches sample or is omitted
        return query.claimNumber === SAMPLE_MICA.job.claimNumber;
      }
      return true;
    }).slice(0, query.limit ?? 20);

    const reports: DryingReport[] = [];
    const warnings: string[] = [];
    let claimNumber = query.claimNumber;
    for (const message of messages) {
      const parsed = dryingReportsFromOutlookMessage({
        ...message,
        claimNumber: message.claimNumber ?? query.claimNumber,
      });
      reports.push(...parsed.reports);
      warnings.push(...parsed.warnings);
      claimNumber = claimNumber ?? parsed.claimNumber;
    }
    return {
      source: this.kind,
      reports,
      claimNumber,
      warnings,
      mode: 'sandbox',
    };
  }
}

class LiveOutlookConnector implements DryingCaptureConnector {
  readonly kind = 'outlook' as const;
  readonly name = 'Outlook drying reports';
  private readonly http: VendorHttpClient;
  private readonly token: string;

  constructor(accessToken: string) {
    this.token = accessToken;
    const baseUrl = config.estimator.outlookGraphBaseUrl || 'https://graph.microsoft.com/v1.0';
    this.http = new VendorHttpClient({
      vendor: this.name,
      baseUrl,
      authHeaders: () => ({ Authorization: `Bearer ${this.token}` }),
    });
  }

  async verify(): Promise<void> {
    await this.http.request({ path: '/me', method: 'GET', idempotent: true });
  }

  async pull(query: CapturePullQuery): Promise<CapturePullResult> {
    const mailbox = config.estimator.outlookMailbox || 'me';
    const folder = config.estimator.outlookFolder || 'inbox';
    const claim = query.claimNumber ?? '';
    const searchBits = ["\"drying report\""];
    if (claim) searchBits.push(`"${claim}"`);
    if (query.since) searchBits.push(`received>=${query.since.slice(0, 10)}`);

    const payload = await this.http.request<{ value?: unknown[] }>({
      path: `/${mailbox}/mailFolders/${folder}/messages`,
      method: 'GET',
      query: {
        $top: query.limit ?? 25,
        $select: 'id,subject,receivedDateTime,body,from',
        $search: searchBits.join(' AND '),
      },
      idempotent: true,
    });

    const normalized = (payload.value ?? []).map((item) => {
      const row = item as {
        id?: string;
        subject?: string;
        receivedDateTime?: string;
        body?: { content?: string };
        from?: { emailAddress?: { address?: string } };
      };
      return {
        id: row.id,
        subject: row.subject,
        receivedAt: row.receivedDateTime,
        body: row.body?.content ?? '',
        from: row.from?.emailAddress?.address,
        claimNumber: query.claimNumber,
      } satisfies OutlookDryingMessage;
    });

    const parsed = dryingReportsFromOutlookPayload({ messages: normalized });
    return {
      source: this.kind,
      reports: parsed.reports,
      claimNumber: parsed.claimNumber ?? query.claimNumber,
      warnings: parsed.warnings,
      mode: 'live',
    };
  }
}
