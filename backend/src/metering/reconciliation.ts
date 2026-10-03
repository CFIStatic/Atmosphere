/**
 * Reconcile our recorded AI cost against the providers' own billing.
 *
 * For each provider and UTC day: our cost = sum(token_usage_events.cost_nanos)
 * (what we priced from provider-reported usage at official rates); their cost
 * = the provider's usage/cost report. Variance over 2% is flagged.
 *
 * Provider reports need admin credentials the API server does not normally
 * hold. Every connector reads OPTIONAL env vars and reports "not connected"
 * (with exactly what it needs) when they are missing. Nothing here writes.
 *
 *   Anthropic  ANTHROPIC_ADMIN_API_KEY (sk-ant-admin01-…, Console › Settings ›
 *              Admin keys). Optional ANTHROPIC_ADMIN_WORKSPACE_ID to compare one
 *              workspace only. Source: GET /v1/organizations/cost_report
 *              (daily buckets, amounts in cents).
 *   Google     Cloud Billing export to BigQuery: GOOGLE_BILLING_EXPORT_TABLE
 *              (`project.dataset.gcp_billing_export_v1_XXXXXX`) and
 *              GOOGLE_BILLING_SERVICE_ACCOUNT_JSON (a service-account key with
 *              BigQuery Data Viewer + BigQuery Job User). Optional
 *              GOOGLE_BILLING_PROJECT_ID to keep only the Gemini API project.
 *              The Gemini Developer API has no usage/cost endpoint of its own.
 *   OpenAI     OPENAI_ADMIN_KEY (organization admin key). Source:
 *              GET /v1/organization/costs (daily buckets, USD).
 *   Tavily     No per-day cost API; compare the monthly invoice by hand.
 */

import { createSign } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectPaged, providerOfModel, TOKEN_USAGE_PAGE } from './tokenUsage.js';

export const RECONCILIATION_THRESHOLD_PCT = 2;

export type ReconProvider = 'anthropic' | 'google' | 'openai' | 'tavily';

export interface ReconDay {
  day: string;
  oursUsd: number;
  theirsUsd: number | null;
  varianceUsd: number | null;
  /** (ours − theirs) / theirs × 100. Null when theirs is 0 or unknown. */
  variancePct: number | null;
  flagged: boolean;
  /** Provider reports lag; the most recent days are shown but never flagged. */
  pending: boolean;
}

export interface ReconProviderReport {
  provider: ReconProvider;
  label: string;
  status: 'connected' | 'not_connected' | 'error' | 'unsupported';
  /** Env vars / exports needed to connect, when not connected. */
  requires: string[];
  source: string;
  note: string | null;
  error: string | null;
  days: ReconDay[];
  totals: { oursUsd: number; theirsUsd: number | null; varianceUsd: number | null; variancePct: number | null; flagged: boolean };
}

export interface ReconciliationReport {
  generatedAt: string;
  window: { from: string; to: string; timeZone: 'UTC' };
  thresholdPct: number;
  flaggedCount: number;
  providers: ReconProviderReport[];
}

type Env = Record<string, string | undefined>;
type DailyUsd = Map<string, number>;

const trim = (v: string | undefined) => (v ?? '').trim();

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function eachUtcDayBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const endMs = Date.parse(to);
  for (let t = start; t < endMs; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Variance and flag for one day / total. */
export function compareCost(oursUsd: number, theirsUsd: number | null, thresholdPct = RECONCILIATION_THRESHOLD_PCT) {
  if (theirsUsd == null) return { varianceUsd: null, variancePct: null, flagged: false };
  const varianceUsd = round6(oursUsd - theirsUsd);
  if (theirsUsd === 0) {
    // They billed nothing; we recorded cost (or both zero).
    return { varianceUsd, variancePct: null, flagged: oursUsd > 0.000001 };
  }
  const variancePct = Math.round(((oursUsd - theirsUsd) / theirsUsd) * 10_000) / 100;
  return { varianceUsd, variancePct, flagged: Math.abs(variancePct) > thresholdPct };
}

/** Our recorded provider cost by provider and UTC day. */
export async function loadOurDailyCost(client: SupabaseClient, from: string, to: string): Promise<Map<ReconProvider, DailyUsd>> {
  const rows = await collectPaged<Record<string, unknown>>(TOKEN_USAGE_PAGE, async (lo, hi) => {
    const { data, error } = await client
      .from('token_usage_events')
      .select('id, created_at, provider, model_id, cost_nanos')
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(lo, hi);
    if (error) throw error;
    return (data ?? []) as Array<Record<string, unknown>>;
  });
  const out = new Map<ReconProvider, DailyUsd>();
  for (const row of rows) {
    const provider = (String(row.provider ?? '') || providerOfModel(row.model_id as string | null) || '') as ReconProvider;
    if (!['anthropic', 'google', 'openai', 'tavily'].includes(provider)) continue;
    const day = String(row.created_at).slice(0, 10);
    const map = out.get(provider) ?? new Map<string, number>();
    map.set(day, (map.get(day) ?? 0) + Number(row.cost_nanos ?? 0) / 1e9);
    out.set(provider, map);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anthropic Admin API — cost report
// ---------------------------------------------------------------------------

export async function anthropicDailyCost(from: string, to: string, env: Env, fetchFn: typeof fetch): Promise<DailyUsd> {
  const key = trim(env.ANTHROPIC_ADMIN_API_KEY);
  const workspace = trim(env.ANTHROPIC_ADMIN_WORKSPACE_ID);
  const out: DailyUsd = new Map();
  let page: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const params = new URLSearchParams({
      starting_at: `${from.slice(0, 10)}T00:00:00Z`,
      ending_at: new Date(Math.ceil(Date.parse(to) / 86_400_000) * 86_400_000).toISOString().replace('.000', ''),
      bucket_width: '1d',
      limit: '31',
    });
    if (workspace) params.append('group_by[]', 'workspace_id');
    if (page) params.set('page', page);
    const res = await fetchFn(`https://api.anthropic.com/v1/organizations/cost_report?${params}`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'User-Agent': 'AtmosphereReconciliation/1.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Anthropic cost_report ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{ starting_at?: string; results?: Array<{ amount?: string | number; currency?: string; workspace_id?: string | null }> }>;
      has_more?: boolean;
      next_page?: string | null;
    };
    for (const bucket of body.data ?? []) {
      const day = String(bucket.starting_at ?? '').slice(0, 10);
      if (!day) continue;
      for (const r of bucket.results ?? []) {
        if (workspace && (r.workspace_id ?? '') !== workspace) continue;
        // Amounts are decimal strings in the lowest currency unit (cents).
        out.set(day, (out.get(day) ?? 0) + Number(r.amount ?? 0) / 100);
      }
    }
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return out;
}

// ---------------------------------------------------------------------------
// OpenAI Costs API
// ---------------------------------------------------------------------------

export async function openAiDailyCost(from: string, to: string, env: Env, fetchFn: typeof fetch): Promise<DailyUsd> {
  const key = trim(env.OPENAI_ADMIN_KEY);
  const out: DailyUsd = new Map();
  let page: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const params = new URLSearchParams({
      start_time: String(Math.floor(Date.parse(`${from.slice(0, 10)}T00:00:00Z`) / 1000)),
      end_time: String(Math.ceil(Date.parse(to) / 1000)),
      bucket_width: '1d',
      limit: '31',
    });
    if (page) params.set('page', page);
    const res = await fetchFn(`https://api.openai.com/v1/organization/costs?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`OpenAI organization/costs ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{ start_time?: number; results?: Array<{ amount?: { value?: number; currency?: string } }> }>;
      has_more?: boolean;
      next_page?: string | null;
    };
    for (const bucket of body.data ?? []) {
      const day = new Date(Number(bucket.start_time ?? 0) * 1000).toISOString().slice(0, 10);
      for (const r of bucket.results ?? []) out.set(day, (out.get(day) ?? 0) + Number(r.amount?.value ?? 0));
    }
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Google Cloud Billing export (BigQuery)
// ---------------------------------------------------------------------------

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function googleAccessToken(serviceAccountJson: string, fetchFn: typeof fetch): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as { client_email?: string; private_key?: string; token_uri?: string };
  if (!sa.client_email || !sa.private_key) throw new Error('service account JSON is missing client_email or private_key');
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/bigquery.readonly',
      aud: tokenUri,
      iat: now,
      exp: now + 600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${base64url(signer.sign(sa.private_key))}`;
  const res = await fetchFn(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Google OAuth ${res.status}`);
  const body = (await res.json()) as { access_token?: string };
  if (!body.access_token) throw new Error('Google OAuth returned no access token');
  return body.access_token;
}

/** `project.dataset.table` — letters, digits, dashes, underscores only. */
export function parseBillingTable(raw: string): { project: string; table: string } | null {
  const m = raw.trim().match(/^([a-z0-9-]+)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)$/);
  return m ? { project: m[1]!, table: `${m[1]}.${m[2]}.${m[3]}` } : null;
}

export async function googleDailyCost(from: string, to: string, env: Env, fetchFn: typeof fetch): Promise<DailyUsd> {
  const parsed = parseBillingTable(trim(env.GOOGLE_BILLING_EXPORT_TABLE));
  if (!parsed) throw new Error('GOOGLE_BILLING_EXPORT_TABLE must be project.dataset.table');
  const token = await googleAccessToken(trim(env.GOOGLE_BILLING_SERVICE_ACCOUNT_JSON), fetchFn);
  const projectFilter = trim(env.GOOGLE_BILLING_PROJECT_ID);
  // Cost net of credits (free tier, promotions), in USD, per usage day.
  const query = `
    SELECT FORMAT_DATE('%F', DATE(usage_start_time)) AS day,
           SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS usd
    FROM \`${parsed.table}\`
    WHERE service.description IN ('Gemini API', 'Generative Language API')
      AND usage_start_time >= @from AND usage_start_time < @to
      ${projectFilter ? 'AND project.id = @project' : ''}
    GROUP BY day ORDER BY day`;
  const queryParameters = [
    { name: 'from', parameterType: { type: 'TIMESTAMP' }, parameterValue: { value: `${from.slice(0, 10)} 00:00:00 UTC` } },
    { name: 'to', parameterType: { type: 'TIMESTAMP' }, parameterValue: { value: new Date(to).toISOString().replace('T', ' ').replace('Z', ' UTC') } },
    ...(projectFilter ? [{ name: 'project', parameterType: { type: 'STRING' }, parameterValue: { value: projectFilter } }] : []),
  ];
  const res = await fetchFn(`https://bigquery.googleapis.com/bigquery/v2/projects/${parsed.project}/queries`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, useLegacySql: false, parameterMode: 'NAMED', queryParameters, timeoutMs: 20_000 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`BigQuery ${res.status}`);
  const body = (await res.json()) as { rows?: Array<{ f?: Array<{ v?: string | null }> }>; jobComplete?: boolean };
  if (body.jobComplete === false) throw new Error('BigQuery query did not finish in time');
  const out: DailyUsd = new Map();
  for (const row of body.rows ?? []) {
    const day = String(row.f?.[0]?.v ?? '');
    if (day) out.set(day, Number(row.f?.[1]?.v ?? 0));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

interface Connector {
  provider: ReconProvider;
  label: string;
  source: string;
  requires: string[];
  /** Days at the end of the window that may not be reported yet. */
  lagDays: number;
  note: string | null;
  isConnected(env: Env): boolean;
  fetch?: (from: string, to: string, env: Env, fetchFn: typeof fetch) => Promise<DailyUsd>;
}

export const CONNECTORS: Connector[] = [
  {
    provider: 'anthropic',
    label: 'Anthropic (Claude)',
    source: 'Anthropic Admin API — Usage & Cost (cost_report)',
    requires: ['ANTHROPIC_ADMIN_API_KEY (Admin API key, sk-ant-admin01-…; optional ANTHROPIC_ADMIN_WORKSPACE_ID)'],
    lagDays: 1,
    note: 'Covers every key in the Anthropic organization (or the one workspace you set). Usage outside the product (dev, evals) shows as variance.',
    isConnected: (env) => Boolean(trim(env.ANTHROPIC_ADMIN_API_KEY)),
    fetch: anthropicDailyCost,
  },
  {
    provider: 'google',
    label: 'Google (Gemini API)',
    source: 'Cloud Billing export to BigQuery (service "Gemini API")',
    requires: [
      'Cloud Billing → BigQuery export enabled (standard usage cost)',
      'GOOGLE_BILLING_EXPORT_TABLE (project.dataset.gcp_billing_export_v1_…)',
      'GOOGLE_BILLING_SERVICE_ACCOUNT_JSON (BigQuery Data Viewer + Job User; optional GOOGLE_BILLING_PROJECT_ID)',
    ],
    lagDays: 2,
    note: 'Billing export lags up to a day or more. Includes explicit context-cache storage and Google Search grounding fees, which are billed per hour / per month and not per call.',
    isConnected: (env) => Boolean(trim(env.GOOGLE_BILLING_EXPORT_TABLE) && trim(env.GOOGLE_BILLING_SERVICE_ACCOUNT_JSON)),
    fetch: googleDailyCost,
  },
  {
    provider: 'openai',
    label: 'OpenAI (transcription)',
    source: 'OpenAI Costs API (organization/costs)',
    requires: ['OPENAI_ADMIN_KEY (organization admin key)'],
    lagDays: 1,
    note: null,
    isConnected: (env) => Boolean(trim(env.OPENAI_ADMIN_KEY)),
    fetch: openAiDailyCost,
  },
  {
    provider: 'tavily',
    label: 'Tavily (web search)',
    source: 'No per-day usage or cost API',
    requires: ['Compare the monthly Tavily invoice by hand'],
    lagDays: 0,
    note: 'Our side is provider-reported credits × $0.008 (pay-as-you-go).',
    isConnected: () => false,
  },
];

export async function buildReconciliation(opts: {
  client: SupabaseClient;
  from: string;
  to: string;
  env?: Env;
  fetchFn?: typeof fetch;
  now?: Date;
  ours?: Map<ReconProvider, DailyUsd>;
}): Promise<ReconciliationReport> {
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? new Date();
  const ours = opts.ours ?? (await loadOurDailyCost(opts.client, opts.from, opts.to));
  const days = eachUtcDayBetween(opts.from, opts.to);
  const providers: ReconProviderReport[] = [];

  for (const c of CONNECTORS) {
    const oursByDay = ours.get(c.provider) ?? new Map<string, number>();
    const connected = c.isConnected(env) && Boolean(c.fetch);
    let theirs: DailyUsd | null = null;
    let error: string | null = null;
    if (connected) {
      try {
        theirs = await c.fetch!(opts.from, opts.to, env, fetchFn);
      } catch (err) {
        // Never echo a response body: it can carry account detail.
        error = err instanceof Error ? err.message.slice(0, 160) : 'request failed';
      }
    }
    const pendingFrom = new Date(now.getTime() - c.lagDays * 86_400_000).toISOString().slice(0, 10);
    const rows: ReconDay[] = [];
    let theirsTotal = 0;
    for (const day of days) {
      const o = round6(oursByDay.get(day) ?? 0);
      const t = theirs ? round6(theirs.get(day) ?? 0) : null;
      if (o === 0 && (t ?? 0) === 0) continue;
      const pending = day >= pendingFrom;
      const cmp = compareCost(o, t);
      rows.push({ day, oursUsd: o, theirsUsd: t, ...cmp, flagged: cmp.flagged && !pending, pending });
      if (!pending) theirsTotal += t ?? 0;
    }
    const settledOurs = rows.filter((r) => !r.pending).reduce((a, r) => a + r.oursUsd, 0);
    const totalCmp = theirs ? compareCost(round6(settledOurs), round6(theirsTotal)) : compareCost(0, null);
    providers.push({
      provider: c.provider,
      label: c.label,
      status: c.provider === 'tavily' ? 'unsupported' : !connected ? 'not_connected' : error ? 'error' : 'connected',
      requires: connected ? [] : c.requires,
      source: c.source,
      note: c.note,
      error,
      days: rows,
      // Totals cover settled days only, so both sides span the same days.
      totals: {
        oursUsd: round6(settledOurs),
        theirsUsd: theirs ? round6(theirsTotal) : null,
        ...totalCmp,
      },
    });
  }

  return {
    generatedAt: now.toISOString(),
    window: { from: opts.from, to: opts.to, timeZone: 'UTC' },
    thresholdPct: RECONCILIATION_THRESHOLD_PCT,
    flaggedCount: providers.reduce((a, p) => a + p.days.filter((d) => d.flagged).length + (p.totals.flagged ? 1 : 0), 0),
    providers,
  };
}
