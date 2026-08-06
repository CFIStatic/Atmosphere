import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { createAdminClient } from '../lib/supabase.js';
import { seal, open, type SealedGrant } from '../lib/integrations/oauthVault.js';

/**
 * Job files from the customer's own CRM.
 *
 * Most companies that buy work verification already run a CRM, and the job
 * file should exist before the first video without anybody retyping an
 * address. So this module pulls *job identity* — title, claim number,
 * address — from the system the customer already keeps it in, and creates or
 * updates Atmosphere job files to match.
 *
 * What it will never do is as important as what it does:
 *
 *   It never writes evidence, scope, custody, or a status transition. The
 *   CRM is a source of identity, not a system of record for proof.
 *
 *   It never moves a geofence under existing evidence. The "filmed on site"
 *   check measures against the job's coordinates, so an address change
 *   arriving from the CRM for a job that already holds footage parks as a
 *   conflict for a person to decide — silently applying it would quietly
 *   re-grade every clip already on file.
 *
 *   It never deletes a job file. A job gone from the CRM archives the link
 *   and nothing else; footage does not evaporate because somebody tidied
 *   their pipeline.
 *
 * The driver port follows the estimator connectors: a mock driver that is
 * the default and makes the whole pipeline exercisable end to end, and an
 * API driver slot that a deployment turns on. Credentials are sealed with
 * the same AES-256-GCM vault the Salesforce grant uses, because the shape of
 * the secret is the same: it belongs to one customer and has to be stored.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type CrmSyncSystem = 'jobnimbus' | 'acculynx' | 'dash' | 'servicetitan';

export const CRM_SYNC_SYSTEMS: ReadonlyArray<{ system: CrmSyncSystem; label: string }> = [
  { system: 'jobnimbus', label: 'JobNimbus' },
  { system: 'acculynx', label: 'AccuLynx' },
  { system: 'dash', label: 'CoreLogic Dash' },
  { system: 'servicetitan', label: 'ServiceTitan' },
];

export function crmSystemLabel(system: string): string {
  return CRM_SYNC_SYSTEMS.find((s) => s.system === system)?.label ?? system;
}

export class CrmSyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

/** The identity a CRM is trusted to supply — and nothing beyond it. */
export interface ExternalJob {
  externalId: string;
  title: string;
  claimNumber?: string | null;
  /** open | closed, in the external system's own terms. Used at create only. */
  externalStatus?: 'open' | 'closed' | null;
  /** A hint like "roof replacement" — mapped to a work type at create only. */
  workHint?: string | null;
  address?: {
    line1: string;
    line2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    lat?: number | null;
    lon?: number | null;
  } | null;
}

export interface CrmSyncDriver {
  readonly kind: 'mock' | 'api';
  /** Prove the credential works and name the account it belongs to. */
  validate(system: CrmSyncSystem, apiKey: string): Promise<{ accountLabel: string }>;
  /** The jobs as the CRM currently tells them. */
  fetchJobs(system: CrmSyncSystem, apiKey: string): Promise<ExternalJob[]>;
}

/* ------------------------------------------------------------------ *
 * Mock driver
 * ------------------------------------------------------------------ */

/**
 * Deterministic sample book per system, so the demo tells the same story
 * every time and tests can assert on it. A key containing "bad" refuses,
 * to keep the failure path honest and exercisable.
 */
class MockCrmDriver implements CrmSyncDriver {
  readonly kind = 'mock' as const;

  async validate(system: CrmSyncSystem, apiKey: string): Promise<{ accountLabel: string }> {
    if (!apiKey.trim() || apiKey.includes('bad')) {
      throw new CrmSyncError(
        `${crmSystemLabel(system)} did not accept that API key.`,
        'invalid_credentials',
      );
    }
    const tail = apiKey.trim().slice(-4).padStart(4, '•');
    return { accountLabel: `${crmSystemLabel(system)} · key …${tail}` };
  }

  async fetchJobs(system: CrmSyncSystem): Promise<ExternalJob[]> {
    return [
      {
        externalId: `${system}-2201`,
        title: 'Kessler Rd — hail, roof replacement',
        claimNumber: 'CLM-90112',
        externalStatus: 'open',
        workHint: 'roof replacement',
        address: {
          line1: '77 Kessler Rd',
          city: 'Austin',
          region: 'TX',
          postalCode: '78704',
          lat: 30.245,
          lon: -97.771,
        },
      },
      {
        externalId: `${system}-2207`,
        title: 'Barton Creek — water loss, kitchen',
        claimNumber: 'CLM-90144',
        externalStatus: 'open',
        workHint: 'water mitigation',
        address: {
          line1: '410 Barton Creek Blvd',
          city: 'Austin',
          region: 'TX',
          postalCode: '78735',
          lat: 30.28,
          lon: -97.84,
        },
      },
      {
        externalId: `${system}-2188`,
        title: 'Pine Hollow — fire rebuild, unit 3',
        claimNumber: null,
        externalStatus: 'closed',
        workHint: 'rebuild',
        address: { line1: '9 Pine Hollow Ct', city: 'Round Rock', region: 'TX', postalCode: '78681' },
      },
    ];
  }
}

/**
 * The real-API slot. Each system gets its own client when a deployment
 * turns it on; until then the refusal names the fact rather than
 * pretending, exactly like web automation on the estimator connectors.
 */
class ApiCrmDriver implements CrmSyncDriver {
  readonly kind = 'api' as const;

  async validate(system: CrmSyncSystem): Promise<{ accountLabel: string }> {
    throw new CrmSyncError(
      `The live ${crmSystemLabel(system)} API client is not configured on this server yet. ` +
        'Set CRM_SYNC_DRIVER=mock to exercise the pipeline, or configure the vendor client.',
      'api_driver_not_configured',
    );
  }

  async fetchJobs(system: CrmSyncSystem): Promise<ExternalJob[]> {
    throw new CrmSyncError(
      `The live ${crmSystemLabel(system)} API client is not configured on this server yet.`,
      'api_driver_not_configured',
    );
  }
}

export function createCrmSyncDriver(
  kind: 'mock' | 'api' = config.crmSync.driver,
): CrmSyncDriver {
  return kind === 'api' ? new ApiCrmDriver() : new MockCrmDriver();
}

/* ------------------------------------------------------------------ *
 * Reconciliation — pure
 * ------------------------------------------------------------------ */

export interface JobLinkRow {
  id: string;
  externalId: string;
  jobId: string;
  identityHash: string;
  archivedAt: string | null;
  pendingKind: string | null;
}

export interface ReconcilePlan {
  creates: ExternalJob[];
  updates: Array<{
    linkId: string;
    jobId: string;
    externalId: string;
    job: ExternalJob;
    /** The link was archived and the CRM row came back. */
    revived: boolean;
  }>;
  conflicts: Array<{ linkId: string; jobId: string; externalId: string; job: ExternalJob }>;
  /** External ids no longer in the CRM: archive the link, keep the job. */
  archives: Array<{ linkId: string; externalId: string }>;
  /**
   * Parked conflicts the CRM has withdrawn or superseded: the link landed in
   * the unchanged/update/archive path while still carrying a pending change.
   * A conflict is the CRM's *current* proposal — one it no longer makes must
   * not sit on the screen waiting to be accepted.
   */
  clearPending: Array<{ linkId: string }>;
  unchanged: number;
}

/**
 * Coordinates are stored as numeric(9,6); comparing at higher precision than
 * the column keeps would make every full-precision CRM feed flap against its
 * own round-tripped value forever.
 */
function roundCoord(n: number | null | undefined): number | null {
  return n === null || n === undefined ? null : Math.round(n * 1e6) / 1e6;
}

/**
 * The identity fingerprint. Only fields sync is allowed to write belong in
 * here — adding a field to the hash without adding it to apply would make
 * every sync report a change it never applies.
 */
export function identityHash(job: ExternalJob): string {
  const a = job.address;
  return createHash('sha256')
    .update(
      JSON.stringify([
        job.title.trim(),
        job.claimNumber?.trim() || null,
        a
          ? [a.line1.trim(), a.line2?.trim() || null, a.city?.trim() || null, a.region?.trim() || null, a.postalCode?.trim() || null, roundCoord(a.lat), roundCoord(a.lon)]
          : null,
      ]),
    )
    .digest('hex');
}

/** Whether the change between two identity states touches the address. */
export function addressChanged(previous: ExternalJob | null, incoming: ExternalJob): boolean {
  const key = (j: ExternalJob | null) => {
    const a = j?.address;
    return a
      ? JSON.stringify([a.line1.trim(), a.city?.trim() || null, a.region?.trim() || null, a.postalCode?.trim() || null, roundCoord(a.lat), roundCoord(a.lon)])
      : 'none';
  };
  return key(previous) !== key(incoming);
}

/**
 * Diff the CRM's current story against the links we hold.
 *
 * `previousByExternalId` carries the identity as last applied (rebuilt from
 * the job file + property), so the address-moved question is answered
 * against what verification is actually using, not against a stale hash.
 */
export function reconcile(input: {
  externals: ExternalJob[];
  links: JobLinkRow[];
  previousByExternalId: Map<string, ExternalJob | null>;
  jobsWithEvidence: Set<string>;
}): ReconcilePlan {
  const plan: ReconcilePlan = { creates: [], updates: [], conflicts: [], archives: [], clearPending: [], unchanged: 0 };
  const linkByExternal = new Map(input.links.map((l) => [l.externalId, l]));
  const seen = new Set<string>();

  for (const external of input.externals) {
    // A feed that repeats an id gets its first row and nothing else — the
    // second occurrence would otherwise become a duplicate create.
    if (seen.has(external.externalId)) continue;
    seen.add(external.externalId);
    const link = linkByExternal.get(external.externalId);
    if (!link) {
      plan.creates.push(external);
      continue;
    }

    const hash = identityHash(external);
    if (hash === link.identityHash && !link.archivedAt) {
      plan.unchanged += 1;
      // The CRM reverted to what we already hold: any parked question about
      // a proposal it no longer makes is moot.
      if (link.pendingKind) plan.clearPending.push({ linkId: link.id });
      continue;
    }

    const previous = input.previousByExternalId.get(external.externalId) ?? null;
    const movesAddress = addressChanged(previous, external);
    if (movesAddress && input.jobsWithEvidence.has(link.jobId)) {
      // The geofence freeze: evidence has been measured against the current
      // address, so the new one waits for a person. (A superseded pending
      // payload is overwritten by this newer proposal in applyPlan.)
      plan.conflicts.push({ linkId: link.id, jobId: link.jobId, externalId: external.externalId, job: external });
      continue;
    }

    plan.updates.push({
      linkId: link.id,
      jobId: link.jobId,
      externalId: external.externalId,
      job: external,
      revived: Boolean(link.archivedAt),
    });
    if (link.pendingKind) plan.clearPending.push({ linkId: link.id });
  }

  for (const link of input.links) {
    if (!seen.has(link.externalId) && !link.archivedAt) {
      plan.archives.push({ linkId: link.id, externalId: link.externalId });
      // The job left the CRM entirely; a parked question about it is moot.
      if (link.pendingKind) plan.clearPending.push({ linkId: link.id });
    }
  }

  return plan;
}

/** Create-time mapping from a CRM's language into ours. Create-time only. */
export function workTypeFor(hint: string | null | undefined): 'mitigation' | 'construction' {
  const h = (hint ?? '').toLowerCase();
  if (/(roof|rebuild|remodel|construction|siding|gutter)/.test(h)) return 'construction';
  return 'mitigation';
}

export function statusFor(externalStatus: 'open' | 'closed' | null | undefined): 'in_progress' | 'completed' {
  return externalStatus === 'closed' ? 'completed' : 'in_progress';
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new CrmSyncError('Job sync needs SUPABASE_SERVICE_ROLE_KEY.', 'no_admin');
  return admin;
}

export async function saveCrmConnection(input: {
  orgId: string;
  userId: string;
  system: CrmSyncSystem;
  apiKey: string;
  accountLabel: string;
}): Promise<void> {
  const sealed = seal(JSON.stringify({ apiKey: input.apiKey }));
  const admin = adminOrThrow();
  const { error } = await admin.from('crm_sync_connections').upsert(
    {
      org_id: input.orgId,
      system: input.system,
      iv: sealed.iv,
      tag: sealed.tag,
      ciphertext: sealed.ciphertext,
      account_label: input.accountLabel,
      connected_by: input.userId,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,system' },
  );
  if (error) throw new CrmSyncError(error.message, 'save_failed');
}

export async function loadCrmConnection(
  orgId: string,
  system: CrmSyncSystem,
): Promise<{ apiKey: string; accountLabel: string | null } | null> {
  const admin = adminOrThrow();
  const { data } = await admin
    .from('crm_sync_connections')
    .select('iv, tag, ciphertext, account_label')
    .eq('org_id', orgId)
    .eq('system', system)
    .maybeSingle();
  if (!data) return null;
  try {
    const parsed = JSON.parse(open(data as SealedGrant));
    return { apiKey: parsed.apiKey, accountLabel: (data as any).account_label ?? null };
  } catch {
    // A credential we cannot decrypt is a credential we do not have.
    return null;
  }
}

export async function listCrmConnections(orgId: string): Promise<
  Array<{ system: string; accountLabel: string | null; connectedAt: string; lastSyncAt: string | null; lastSummary: any }>
> {
  const admin = adminOrThrow();
  const { data } = await admin
    .from('crm_sync_connections')
    .select('system, account_label, connected_at, last_sync_at, last_summary')
    .eq('org_id', orgId);
  return (data ?? []).map((row: any) => ({
    system: row.system,
    accountLabel: row.account_label,
    connectedAt: row.connected_at,
    lastSyncAt: row.last_sync_at,
    lastSummary: row.last_summary,
  }));
}

export async function deleteCrmConnection(orgId: string, system: CrmSyncSystem): Promise<void> {
  const admin = adminOrThrow();
  await admin.from('crm_sync_connections').delete().eq('org_id', orgId).eq('system', system);
}

/**
 * Execute a plan. Each step writes exactly what the rules allow: identity
 * fields on jobs and properties, links as the ledger of what happened.
 */
export async function applyPlan(input: {
  orgId: string;
  system: CrmSyncSystem;
  plan: ReconcilePlan;
  createdBy: string;
}): Promise<{ created: number; updated: number; conflicts: number; archived: number; unchanged: number }> {
  const admin = adminOrThrow();
  const now = new Date().toISOString();
  const { orgId, system, plan } = input;

  for (const external of plan.creates) {
    let propertyId: string | null = null;
    if (external.address) {
      const { data: property, error } = await admin
        .from('crm_properties')
        .insert({
          org_id: orgId,
          address_line1: external.address.line1,
          address_line2: external.address.line2 ?? null,
          city: external.address.city ?? null,
          region: external.address.region ?? null,
          postal_code: external.address.postalCode ?? null,
          latitude: external.address.lat ?? null,
          longitude: external.address.lon ?? null,
        })
        .select('id')
        .single();
      if (error) throw new CrmSyncError(error.message, 'property_create_failed');
      propertyId = (property as any).id;
    }

    const { data: job, error: jobError } = await admin
      .from('crm_jobs')
      .insert({
        org_id: orgId,
        title: external.title,
        claim_number: external.claimNumber ?? null,
        work_type: workTypeFor(external.workHint),
        status: statusFor(external.externalStatus),
        property_id: propertyId,
        created_by: input.createdBy,
      })
      .select('id')
      .single();
    if (jobError) throw new CrmSyncError(jobError.message, 'job_create_failed');

    const { error: linkError } = await admin.from('crm_job_links').insert({
      org_id: orgId,
      system,
      external_id: external.externalId,
      job_id: (job as any).id,
      identity_hash: identityHash(external),
      first_seen_at: now,
      last_seen_at: now,
    });
    if (linkError) {
      // The three inserts are not one transaction, so a failed link must not
      // strand the job it was meant to anchor — an unlinked job file would be
      // recreated as a duplicate on the very next sync. Unwind, then decide:
      // a unique violation means a concurrent sync won the race and the job
      // exists under ITS link, so this copy just goes away; anything else is
      // a real failure and is thrown after the cleanup.
      await admin.from('crm_jobs').delete().eq('id', (job as any).id);
      if (propertyId) await admin.from('crm_properties').delete().eq('id', propertyId);
      if ((linkError as any).code === '23505') continue;
      throw new CrmSyncError(linkError.message, 'link_create_failed');
    }

    // Provenance. Written after the link survives, because a job whose link
    // was unwound above no longer exists to have a source. Not fatal on
    // failure: a job file that works but reports "source unknown" beats
    // failing a sync over a bookkeeping row.
    await admin
      .from('job_intake')
      .insert({
        job_id: (job as any).id,
        org_id: orgId,
        source: 'crm_sync',
        source_detail: { system, externalId: external.externalId },
        entered_by: input.createdBy ?? null,
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }

  for (const update of plan.updates) {
    const { error: jobError } = await admin
      .from('crm_jobs')
      .update({
        title: update.job.title,
        claim_number: update.job.claimNumber ?? null,
        updated_at: now,
      })
      .eq('id', update.jobId)
      .eq('org_id', orgId);
    if (jobError) throw new CrmSyncError(jobError.message, 'job_update_failed');

    if (update.job.address) {
      await writeJobAddress(admin, orgId, update.jobId, update.job.address);
    }

    await admin
      .from('crm_job_links')
      .update({
        identity_hash: identityHash(update.job),
        last_seen_at: now,
        archived_at: null,
      })
      .eq('id', update.linkId);
  }

  for (const conflict of plan.conflicts) {
    await admin
      .from('crm_job_links')
      .update({
        pending: {
          title: conflict.job.title,
          claimNumber: conflict.job.claimNumber ?? null,
          address: conflict.job.address,
        },
        pending_kind: 'address_moved',
        last_seen_at: now,
      })
      .eq('id', conflict.linkId);
  }

  for (const archive of plan.archives) {
    await admin.from('crm_job_links').update({ archived_at: now }).eq('id', archive.linkId);
  }

  // Questions the CRM has withdrawn: cleared last so a link that both parks
  // a NEW conflict and clears an old one nets out to the new question.
  for (const clear of plan.clearPending) {
    if (plan.conflicts.some((c) => c.linkId === clear.linkId)) continue;
    await admin
      .from('crm_job_links')
      .update({ pending: null, pending_kind: null })
      .eq('id', clear.linkId);
  }

  return {
    created: plan.creates.length,
    updated: plan.updates.length,
    conflicts: plan.conflicts.length,
    archived: plan.archives.length,
    unchanged: plan.unchanged,
  };
}

/**
 * Write a job's address. Properties are shareable between jobs by design, so
 * a sync-driven address change never edits a property another job also points
 * at — that would move a second job's geofence as a side effect nobody
 * decided. Shared rows get copy-on-write: a fresh property for this job.
 */
export async function writeJobAddress(
  admin: any,
  orgId: string,
  jobId: string,
  address: NonNullable<ExternalJob['address']>,
): Promise<void> {
  const row = {
    address_line1: address.line1,
    address_line2: address.line2 ?? null,
    city: address.city ?? null,
    region: address.region ?? null,
    postal_code: address.postalCode ?? null,
    latitude: address.lat ?? null,
    longitude: address.lon ?? null,
  };

  const { data: job } = await admin
    .from('crm_jobs')
    .select('property_id')
    .eq('id', jobId)
    .maybeSingle();
  const propertyId = (job as any)?.property_id ?? null;

  if (propertyId) {
    const { count } = await admin
      .from('crm_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .neq('id', jobId);
    if (!count) {
      await admin.from('crm_properties').update(row).eq('id', propertyId);
      return;
    }
  }

  const { data: property } = await admin
    .from('crm_properties')
    .insert({ org_id: orgId, ...row })
    .select('id')
    .single();
  if (property) {
    await admin.from('crm_jobs').update({ property_id: (property as any).id }).eq('id', jobId);
  }
}
