import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../lib/errors.js';
import { toOrgProductRole } from '../lib/productRoles.js';
import { openSecret, sealSecret, type ProviderSecret } from './credentials.js';
import type { SecretsByProvider } from './connectors/index.js';
import type { EstimatorRun, Provider, RunEvent, RunStage, RunStatus } from './types.js';

/**
 * Persistence for the estimator.
 *
 * Every query here runs through a Supabase client carrying the caller's JWT, so
 * Row Level Security — not this file — decides what a user can see. That is the
 * same guarantee the rest of the app relies on, and it means a bug in a filter
 * clause below cannot leak another organization's runs.
 *
 * The one thing RLS cannot protect is the credential ciphertext, which is why
 * it is encrypted with a key that lives only in the server's environment. A row
 * read by the wrong person is inert.
 */

/* ------------------------------------------------------------------ */
/* Org resolution                                                      */
/* ------------------------------------------------------------------ */

export interface Membership {
  orgId: string;
  role: string;
}

/** Both product seats can store org-wide vendor credentials (billing is separate). */
function canManageCredentials(role: string): boolean {
  const seat = toOrgProductRole(role);
  return seat === 'global_admin' || seat === 'employee';
}

export async function requireMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<Membership> {
  const { data, error } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) throw new HttpError(500, error.message, 'membership_lookup_failed');
  const row = data?.[0];
  if (!row) {
    throw new HttpError(403, 'Join an organization before using the estimator.', 'not_onboarded');
  }
  return { orgId: row.org_id as string, role: row.role as string };
}

export function assertCanManageCredentials(membership: Membership): void {
  if (!canManageCredentials(membership.role)) {
    throw new HttpError(
      403,
      'Only a Global Admin or Employee can connect the estimator to DocuSketch, Dash, or Xactimate.',
      'insufficient_role',
    );
  }
}

/* ------------------------------------------------------------------ */
/* Credentials                                                         */
/* ------------------------------------------------------------------ */

export interface CredentialSummary {
  provider: Provider;
  label: string | null;
  /** Non-reversible tag so the UI can show which secret is stored. */
  fingerprint: string;
  /** Present only when the org overrode the server's vendor host. */
  baseUrl: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export async function listCredentials(
  supabase: SupabaseClient,
  orgId: string,
): Promise<CredentialSummary[]> {
  const { data, error } = await supabase
    .from('estimator_credentials')
    .select('provider, label, fingerprint, base_url, updated_at, updated_by')
    .eq('org_id', orgId);

  if (error) throw new HttpError(500, error.message, 'credentials_read_failed');

  return (data ?? []).map((row) => ({
    provider: row.provider as Provider,
    label: (row.label as string | null) ?? null,
    fingerprint: row.fingerprint as string,
    baseUrl: (row.base_url as string | null) ?? null,
    updatedAt: row.updated_at as string,
    updatedBy: (row.updated_by as string | null) ?? null,
  }));
}

export async function saveCredential(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    userId: string;
    provider: Provider;
    label?: string;
    secret: ProviderSecret;
  },
): Promise<CredentialSummary> {
  const sealed = sealSecret(params.secret);

  const { data, error } = await supabase
    .from('estimator_credentials')
    .upsert(
      {
        org_id: params.orgId,
        provider: params.provider,
        label: params.label ?? null,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        auth_tag: sealed.authTag,
        fingerprint: sealed.fingerprint,
        // Stored alongside the secret rather than inside it so the host can be
        // read back for display without decrypting anything.
        base_url: params.secret.baseUrl ?? null,
        updated_by: params.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,provider' },
    )
    .select('provider, label, fingerprint, base_url, updated_at, updated_by')
    .single();

  if (error) throw new HttpError(400, error.message, 'credential_save_failed');

  return {
    provider: data.provider as Provider,
    label: (data.label as string | null) ?? null,
    fingerprint: data.fingerprint as string,
    baseUrl: (data.base_url as string | null) ?? null,
    updatedAt: data.updated_at as string,
    updatedBy: (data.updated_by as string | null) ?? null,
  };
}

export async function deleteCredential(
  supabase: SupabaseClient,
  orgId: string,
  provider: Provider,
): Promise<void> {
  const { error } = await supabase
    .from('estimator_credentials')
    .delete()
    .eq('org_id', orgId)
    .eq('provider', provider);

  if (error) throw new HttpError(400, error.message, 'credential_delete_failed');
}

/** Decrypt every stored credential for an org, for use by a run. */
export async function loadSecrets(
  supabase: SupabaseClient,
  orgId: string,
): Promise<SecretsByProvider> {
  const { data, error } = await supabase
    .from('estimator_credentials')
    .select('provider, ciphertext, iv, auth_tag, fingerprint, base_url')
    .eq('org_id', orgId);

  if (error) throw new HttpError(500, error.message, 'credentials_read_failed');

  const secrets: SecretsByProvider = {};
  for (const row of data ?? []) {
    const secret = openSecret({
      ciphertext: row.ciphertext as string,
      iv: row.iv as string,
      authTag: row.auth_tag as string,
      fingerprint: row.fingerprint as string,
    });
    // The column is authoritative for the host: it survives a secret rotation
    // that forgot to repeat it.
    secrets[row.provider as Provider] = {
      ...secret,
      baseUrl: (row.base_url as string | null) ?? secret.baseUrl,
    };
  }
  return secrets;
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

function toRun(row: any): EstimatorRun {
  return {
    id: row.id,
    orgId: row.org_id,
    createdBy: row.created_by,
    status: row.status,
    stage: row.stage,
    scanProjectId: row.scan_project_id,
    crmJobId: row.crm_job_id ?? null,
    matchScore: row.match_score ?? null,
    matchNeedsReview: Boolean(row.match_needs_review),
    matchCandidates: row.match_candidates ?? [],
    matchReason: row.match_reason ?? null,
    scanProject: row.scan_project ?? null,
    job: row.job ?? null,
    observations: row.observations ?? [],
    mitigation: row.mitigation ?? null,
    estimate: row.estimate ?? null,
    exportRef: row.export_ref ?? null,
    error: row.error ?? null,
    events: row.events ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createRun(
  supabase: SupabaseClient,
  params: { orgId: string; userId: string; scanProjectId: string },
): Promise<EstimatorRun> {
  const { data, error } = await supabase
    .from('estimator_runs')
    .insert({
      org_id: params.orgId,
      created_by: params.userId,
      status: 'running' satisfies RunStatus,
      stage: 'queued' satisfies RunStage,
      scan_project_id: params.scanProjectId,
      events: [],
      observations: [],
    })
    .select('*')
    .single();

  if (error) throw new HttpError(400, error.message, 'run_create_failed');
  return toRun(data);
}

/** Columns a stage is allowed to write. Keeps updates explicit and auditable. */
export interface RunPatch {
  status?: RunStatus;
  stage?: RunStage;
  crmJobId?: string | null;
  matchScore?: number | null;
  matchNeedsReview?: boolean;
  matchCandidates?: unknown;
  matchReason?: string | null;
  scanProject?: unknown;
  job?: unknown;
  observations?: unknown;
  mitigation?: unknown;
  estimate?: unknown;
  exportRef?: string | null;
  error?: string | null;
  events?: RunEvent[];
}

export async function updateRun(
  supabase: SupabaseClient,
  runId: string,
  patch: RunPatch,
): Promise<EstimatorRun> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.stage !== undefined) row.stage = patch.stage;
  if (patch.crmJobId !== undefined) row.crm_job_id = patch.crmJobId;
  if (patch.matchScore !== undefined) row.match_score = patch.matchScore;
  if (patch.matchNeedsReview !== undefined) row.match_needs_review = patch.matchNeedsReview;
  if (patch.matchCandidates !== undefined) row.match_candidates = patch.matchCandidates;
  if (patch.matchReason !== undefined) row.match_reason = patch.matchReason;
  if (patch.scanProject !== undefined) row.scan_project = patch.scanProject;
  if (patch.job !== undefined) row.job = patch.job;
  if (patch.observations !== undefined) row.observations = patch.observations;
  if (patch.mitigation !== undefined) row.mitigation = patch.mitigation;
  if (patch.estimate !== undefined) row.estimate = patch.estimate;
  if (patch.exportRef !== undefined) row.export_ref = patch.exportRef;
  if (patch.error !== undefined) row.error = patch.error;
  if (patch.events !== undefined) row.events = patch.events;

  const { data, error } = await supabase
    .from('estimator_runs')
    .update(row)
    .eq('id', runId)
    .select('*')
    .single();

  if (error) throw new HttpError(400, error.message, 'run_update_failed');
  return toRun(data);
}

export async function getRun(supabase: SupabaseClient, runId: string): Promise<EstimatorRun> {
  const { data, error } = await supabase
    .from('estimator_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, 'run_read_failed');
  // RLS turns "another org's run" into "no row", so this is a 404 either way.
  if (!data) throw new HttpError(404, 'Estimator run not found.', 'run_not_found');
  return toRun(data);
}

export async function listRuns(
  supabase: SupabaseClient,
  orgId: string,
  limit = 20,
): Promise<EstimatorRun[]> {
  const { data, error } = await supabase
    .from('estimator_runs')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new HttpError(500, error.message, 'runs_read_failed');
  return (data ?? []).map(toRun);
}
