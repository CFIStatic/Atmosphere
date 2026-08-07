import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext, requireOrgRole } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import {
  CRM_SYNC_SYSTEMS,
  CrmSyncError,
  createCrmSyncDriver,
  crmSystemLabel,
  deleteCrmConnection,
  identityHash,
  listCrmConnections,
  loadCrmConnection,
  reconcile,
  saveCrmConnection,
  applyPlan,
  writeJobAddress,
  type ExternalJob,
  type JobLinkRow,
} from '../crm/sync.js';

/**
 * Job files from the customer's own CRM: connect, sync, and the one human
 * decision sync is not allowed to make on its own.
 *
 * The routes hold no policy — the rules live in crm/sync.ts where they are
 * tested. What lives here is assembly: reading the org's links and jobs into
 * the reconciler's shape, and writing the plan back through applyPlan.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const crmSyncRouter = Router();
crmSyncRouter.use(requireAuth);

const connectLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many connection attempts. Wait a few minutes.', code: 'rate_limited' },
});

const systemSchema = z.enum(['jobnimbus', 'acculynx', 'dash', 'servicetitan']);

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new HttpError(503, 'Job sync is not configured on this server.', 'no_admin');
  return admin;
}

/** GET /api/crm-sync/status — every system, connected or not, plus conflicts. */
crmSyncRouter.get('/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgContext(req);
    const [connections, admin] = [await listCrmConnections(orgId), adminOrThrow()];
    const bySystem = new Map(connections.map((c) => [c.system, c]));

    const { count } = await admin
      .from('crm_job_links')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .not('pending', 'is', null);

    res.json({
      driver: createCrmSyncDriver().kind,
      conflictsPending: count ?? 0,
      systems: CRM_SYNC_SYSTEMS.map(({ system, label }) => {
        const connection = bySystem.get(system);
        return {
          system,
          label,
          connected: Boolean(connection),
          accountLabel: connection?.accountLabel ?? null,
          connectedAt: connection?.connectedAt ?? null,
          lastSyncAt: connection?.lastSyncAt ?? null,
          lastSummary: connection?.lastSummary ?? null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/crm-sync/connect — prove the key works, then seal it. */
crmSyncRouter.post(
  '/connect',
  connectLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ system: systemSchema, apiKey: z.string().min(4).max(500) })
        .parse(req.body);
      // Handing over the org's CRM credential is an owner/admin act, exactly
      // like the Salesforce grant it sits next to in Settings.
      const { orgId, userId } = await requireOrgRole(req, ['owner', 'admin']);

      const driver = createCrmSyncDriver();
      const { accountLabel } = await driver.validate(body.system, body.apiKey);

      await saveCrmConnection({
        orgId,
        userId,
        system: body.system,
        apiKey: body.apiKey,
        accountLabel,
      });

      res.status(201).json({ status: 'connected', system: body.system, accountLabel });
    } catch (err) {
      if (err instanceof CrmSyncError) {
        next(new HttpError(err.code === 'invalid_credentials' ? 401 : 503, err.message, err.code));
        return;
      }
      next(err);
    }
  },
);

/** POST /api/crm-sync/disconnect — our copy of the key dies now. */
crmSyncRouter.post('/disconnect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ system: systemSchema }).parse(req.body);
    const { orgId } = await requireOrgRole(req, ['owner', 'admin']);
    await deleteCrmConnection(orgId, body.system);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Which of the linked jobs hold footage — the set the geofence freeze
 * protects. Exact by construction: scoped to the linked jobs (never the
 * whole org's proof table) and paged to completion, because a truncated
 * evidence set here silently disables the one rule this feature exists to
 * enforce. Any read failure is thrown, not treated as "no evidence".
 */
async function evidenceSetFor(admin: any, jobIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!jobIds.length) return out;
  const PAGE = 1000;
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await admin
      .from('job_proofs')
      .select('job_id')
      .in('job_id', jobIds)
      .order('job_id')
      .range(start, start + PAGE - 1);
    if (error) throw new HttpError(500, error.message, 'evidence_read_failed');
    for (const row of (data ?? []) as any[]) out.add(row.job_id);
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

/**
 * Rebuild the identity sync last applied, from what the job file actually
 * holds. The address-moved question is answered against the coordinates
 * verification is measuring with — not against a hash that could go stale.
 */
async function previousIdentities(
  admin: any,
  orgId: string,
  links: Array<{ externalId: string; jobId: string }>,
): Promise<Map<string, ExternalJob | null>> {
  const out = new Map<string, ExternalJob | null>();
  if (!links.length) return out;

  const jobIds = links.map((l) => l.jobId);
  const { data: jobs } = await admin
    .from('crm_jobs')
    .select('id, title, claim_number, property_id')
    .eq('org_id', orgId)
    .in('id', jobIds);
  const jobById = new Map<string, any>((jobs ?? []).map((j: any) => [j.id, j]));

  const propertyIds = (jobs ?? []).map((j: any) => j.property_id).filter(Boolean);
  const { data: properties } = propertyIds.length
    ? await admin
        .from('crm_properties')
        .select('id, address_line1, address_line2, city, region, postal_code, latitude, longitude')
        .in('id', propertyIds)
    : { data: [] };
  const propertyById = new Map<string, any>((properties ?? []).map((p: any) => [p.id, p]));

  for (const link of links) {
    const job = jobById.get(link.jobId);
    if (!job) {
      out.set(link.externalId, null);
      continue;
    }
    const property = job.property_id ? propertyById.get(job.property_id) : null;
    out.set(link.externalId, {
      externalId: link.externalId,
      title: job.title,
      claimNumber: job.claim_number,
      address: property
        ? {
            line1: property.address_line1,
            line2: property.address_line2,
            city: property.city,
            region: property.region,
            postalCode: property.postal_code,
            lat: property.latitude === null ? null : Number(property.latitude),
            lon: property.longitude === null ? null : Number(property.longitude),
          }
        : null,
    });
  }
  return out;
}

/** POST /api/crm-sync/sync — pull the CRM's story and reconcile it. */
crmSyncRouter.post('/sync', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = z.object({ system: systemSchema }).parse(req.body);
    // Sync writes job files; running it is an owner/admin act like the
    // connect that enables it.
    const { orgId, userId } = await requireOrgRole(req, ['owner', 'admin']);
    const admin = adminOrThrow();

    const connection = await loadCrmConnection(orgId, body.system);
    if (!connection) {
      throw new HttpError(409, `${crmSystemLabel(body.system)} is not connected.`, 'not_connected');
    }

    const driver = createCrmSyncDriver();
    const externals = await driver.fetchJobs(body.system, connection.apiKey);

    const { data: linkRows, error: linksError } = await admin
      .from('crm_job_links')
      .select('id, external_id, job_id, identity_hash, archived_at, pending_kind')
      .eq('org_id', orgId)
      .eq('system', body.system);
    // A failed read here is a failed sync, loudly. Proceeding with an empty
    // list would archive every link and re-create every job.
    if (linksError) throw new HttpError(500, linksError.message, 'links_read_failed');
    const links: JobLinkRow[] = (linkRows ?? []).map((row: any) => ({
      id: row.id,
      externalId: row.external_id,
      jobId: row.job_id,
      identityHash: row.identity_hash,
      archivedAt: row.archived_at,
      pendingKind: row.pending_kind,
    }));

    const jobsWithEvidence = await evidenceSetFor(
      admin,
      links.map((l) => l.jobId),
    );

    const previous = await previousIdentities(admin, orgId, links);
    const plan = reconcile({ externals, links, previousByExternalId: previous, jobsWithEvidence });
    const summary = await applyPlan({ orgId, system: body.system, plan, createdBy: userId });

    await admin
      .from('crm_sync_connections')
      .update({ last_sync_at: new Date().toISOString(), last_summary: summary })
      .eq('org_id', orgId)
      .eq('system', body.system);

    res.json({ summary });
  } catch (err) {
    if (err instanceof CrmSyncError) {
      next(new HttpError(503, err.message, err.code));
      return;
    }
    next(err);
  }
});

/** GET /api/crm-sync/conflicts — the decisions waiting on a person. */
crmSyncRouter.get('/conflicts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { supabase, orgId } = await requireOrgContext(req);
    const { data: links, error } = await supabase
      .from('crm_job_links')
      .select('id, system, external_id, job_id, pending, pending_kind, last_seen_at')
      .eq('org_id', orgId)
      .not('pending', 'is', null)
      .order('last_seen_at', { ascending: false })
      .limit(100);
    if (error) throw new HttpError(500, error.message, 'conflicts_failed');

    const jobIds = [...new Set((links ?? []).map((l: any) => l.job_id))];
    const { data: jobs } = jobIds.length
      ? await supabase.from('crm_jobs').select('id, title, job_number').in('id', jobIds)
      : { data: [] };
    const jobById = new Map<string, any>((jobs ?? []).map((j: any) => [j.id, j]));

    res.json({
      conflicts: (links ?? []).map((link: any) => ({
        linkId: link.id,
        system: link.system,
        systemLabel: crmSystemLabel(link.system),
        externalId: link.external_id,
        jobId: link.job_id,
        jobTitle: jobById.get(link.job_id)?.title ?? null,
        jobNumber: jobById.get(link.job_id)?.job_number ?? null,
        kind: link.pending_kind,
        incoming: link.pending,
        seenAt: link.last_seen_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/crm-sync/conflicts/:linkId — the human decision.
 *
 * accept_new_address moves the geofence knowingly; keep_current dismisses
 * the CRM's version. Either way the parked change clears — a conflict is a
 * question, and questions get answered, not accumulated.
 */
crmSyncRouter.post(
  '/conflicts/:linkId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ decision: z.enum(['accept_new_address', 'keep_current']) })
        .parse(req.body);
      // Moving a geofence — or refusing to — is the same class of act as
      // running the sync that parked the question.
      const { orgId } = await requireOrgRole(req, ['owner', 'admin']);
      const admin = adminOrThrow();

      const { data: link } = await admin
        .from('crm_job_links')
        .select('id, external_id, job_id, pending, pending_kind')
        .eq('org_id', orgId)
        .eq('id', req.params.linkId)
        .maybeSingle();
      if (!link || !(link as any).pending) {
        throw new HttpError(404, 'No such pending change.', 'not_found');
      }

      const incoming = (link as any).pending;

      if (body.decision === 'accept_new_address') {
        const { data: job } = await admin
          .from('crm_jobs')
          .select('id')
          .eq('id', (link as any).job_id)
          .maybeSingle();
        if (!job) throw new HttpError(404, 'The job file no longer exists.', 'job_not_found');

        await admin
          .from('crm_jobs')
          .update({
            title: incoming.title,
            claim_number: incoming.claimNumber ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', (job as any).id);

        if (incoming.address) {
          await writeJobAddress(admin, orgId, (job as any).id, incoming.address);
        }
      }

      // Either way, the CRM's current story is now *answered* — recorded in
      // the identity hash so the next sync reads it as unchanged. Without
      // this, "keep current" resurrects the same question every sync, and
      // the human decision never sticks.
      await admin
        .from('crm_job_links')
        .update({
          pending: null,
          pending_kind: null,
          identity_hash: identityHash({
            externalId: (link as any).external_id,
            title: incoming.title,
            claimNumber: incoming.claimNumber ?? null,
            address: incoming.address ?? null,
          }),
        })
        .eq('id', (link as any).id);

      res.json({ ok: true, decision: body.decision });
    } catch (err) {
      next(err);
    }
  },
);
