import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ZodSchema } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import {
  listQuerySchema,
  accountCreateSchema,
  accountUpdateSchema,
  accountToRow,
  contactCreateSchema,
  contactUpdateSchema,
  contactToRow,
  propertyCreateSchema,
  propertyUpdateSchema,
  propertyToRow,
  leadCreateSchema,
  leadUpdateSchema,
  leadToRow,
  leadConvertSchema,
  jobCreateSchema,
  jobUpdateSchema,
  jobToRow,
  activityCreateSchema,
  activityUpdateSchema,
  activityToRow,
  auditQuerySchema,
} from '../lib/crmValidation.js';

export const crmRouter = Router();

crmRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The CRM's HTTP surface.
 *
 * Six entities share one CRUD shape, so it is defined once and instantiated per
 * entity rather than copied six times — the alternative is six chances to
 * forget an org filter.
 *
 * Every query runs through the caller's JWT (see requireOrgContext), so Row
 * Level Security is enforcing tenancy underneath all of this. The explicit
 * `.eq('org_id', …)` filters below are belt-and-braces: they keep a
 * misconfigured policy from turning into a cross-tenant read, and they let
 * Postgres use the org-leading indexes.
 */

/** snake_case row → camelCase JSON, without hand-writing a serializer per table. */
function camelize(row: Record<string, any> | null): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[camel] = value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
      ? camelizeNested(value)
      : value;
  }
  return out;
}

/** Embedded relations (`profiles(...)`) come back as nested objects. */
function camelizeNested(value: Record<string, any>): Record<string, any> {
  return camelize(value) ?? {};
}

interface ResourceDef {
  /** URL segment, e.g. 'contacts'. */
  path: string;
  /** Database table. */
  table: string;
  /** Columns returned by list/read. */
  select: string;
  createSchema: ZodSchema<any>;
  updateSchema: ZodSchema<any>;
  toRow: (v: any) => Record<string, unknown>;
  /** Columns a `?search=` term matches against, ILIKE. */
  searchColumns: string[];
  /** Default ordering for lists. */
  orderBy: { column: string; ascending: boolean };
  /** Whether the table carries an `is_archived` flag. */
  archivable: boolean;
}

/**
 * PostgREST's `or()` takes a comma-separated filter string, so a search term
 * containing a comma or a parenthesis would otherwise change the shape of the
 * filter rather than being matched literally. Strip those, and the ILIKE
 * wildcards, so a search is always just a search.
 */
function sanitizeSearch(term: string): string {
  return term.replace(/[,()*%\\]/g, ' ').trim();
}

function registerResource(def: ResourceDef): void {
  const base = `/${def.path}`;

  /** List — paginated, optionally filtered by a search term. */
  crmRouter.get(base, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { limit, offset, search, includeArchived } = listQuerySchema.parse(req.query);

      let query = supabase
        .from(def.table)
        .select(def.select, { count: 'exact' })
        .eq('org_id', orgId);

      if (def.archivable && !includeArchived) query = query.eq('is_archived', false);

      if (search) {
        const term = sanitizeSearch(search);
        if (term) {
          query = query.or(def.searchColumns.map((c) => `${c}.ilike.%${term}%`).join(','));
        }
      }

      const { data, error, count } = await query
        .order(def.orderBy.column, { ascending: def.orderBy.ascending })
        .range(offset, offset + limit - 1);

      if (error) throw new HttpError(500, error.message, `${def.path}_list_failed`);

      res.json({
        items: (data ?? []).map((row) => camelize(row as Record<string, any>)),
        total: count ?? 0,
        limit,
        offset,
      });
    } catch (err) {
      next(err);
    }
  });

  /** Read one. */
  crmRouter.get(`${base}/:id`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { data, error } = await supabase
        .from(def.table)
        .select(def.select)
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();

      if (error) throw new HttpError(500, error.message, `${def.path}_read_failed`);
      if (!data) throw new HttpError(404, 'Not found', 'not_found');

      res.json({ item: camelize(data as Record<string, any>) });
    } catch (err) {
      next(err);
    }
  });

  /** Create. org_id and created_by come from the session, never the body. */
  crmRouter.post(base, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const parsed = def.createSchema.parse(req.body);

      const { data, error } = await supabase
        .from(def.table)
        .insert({ ...def.toRow(parsed), org_id: orgId, created_by: userId })
        .select(def.select)
        .single();

      if (error) throw new HttpError(400, error.message, `${def.path}_create_failed`);
      res.status(201).json({ item: camelize(data as Record<string, any>) });
    } catch (err) {
      next(err);
    }
  });

  /** Partial update. Omitted fields are left alone; explicit null clears. */
  crmRouter.patch(`${base}/:id`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const parsed = def.updateSchema.parse(req.body);
      const row = def.toRow(parsed);

      if (Object.keys(row).length === 0) {
        throw new HttpError(400, 'Nothing to update', 'empty_update');
      }

      const { data, error } = await supabase
        .from(def.table)
        .update(row)
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .select(def.select)
        .maybeSingle();

      if (error) throw new HttpError(400, error.message, `${def.path}_update_failed`);
      if (!data) throw new HttpError(404, 'Not found', 'not_found');

      res.json({ item: camelize(data as Record<string, any>) });
    } catch (err) {
      next(err);
    }
  });

  /**
   * Delete.
   *
   * Archivable records archive by default and only hard-delete with
   * `?hard=true`. Customer history is the asset this whole system exists to
   * accumulate, and a misplaced click should not be able to burn it — the
   * change ledger would let us put it back, but not needing to is better.
   */
  crmRouter.delete(`${base}/:id`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const hard = req.query.hard === 'true';

      if (def.archivable && !hard) {
        const { data, error } = await supabase
          .from(def.table)
          .update({ is_archived: true })
          .eq('org_id', orgId)
          .eq('id', req.params.id)
          .select('id')
          .maybeSingle();

        if (error) throw new HttpError(400, error.message, `${def.path}_archive_failed`);
        if (!data) throw new HttpError(404, 'Not found', 'not_found');

        res.json({ archived: true, id: req.params.id });
        return;
      }

      const { data, error } = await supabase
        .from(def.table)
        .delete()
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .select('id')
        .maybeSingle();

      if (error) throw new HttpError(400, error.message, `${def.path}_delete_failed`);
      if (!data) throw new HttpError(404, 'Not found', 'not_found');

      res.json({ deleted: true, id: req.params.id });
    } catch (err) {
      next(err);
    }
  });
}

/* ------------------------------------------------------------- resources */

registerResource({
  path: 'accounts',
  table: 'crm_accounts',
  select: '*',
  createSchema: accountCreateSchema,
  updateSchema: accountUpdateSchema,
  toRow: accountToRow,
  searchColumns: ['name', 'email', 'phone', 'city'],
  orderBy: { column: 'name', ascending: true },
  archivable: true,
});

registerResource({
  path: 'contacts',
  table: 'crm_contacts',
  select: '*',
  createSchema: contactCreateSchema,
  updateSchema: contactUpdateSchema,
  toRow: contactToRow,
  searchColumns: ['first_name', 'last_name', 'company_name', 'email', 'phone', 'mobile'],
  orderBy: { column: 'created_at', ascending: false },
  archivable: true,
});

registerResource({
  path: 'properties',
  table: 'crm_properties',
  select: '*',
  createSchema: propertyCreateSchema,
  updateSchema: propertyUpdateSchema,
  toRow: propertyToRow,
  searchColumns: ['label', 'address_line1', 'city', 'postal_code'],
  orderBy: { column: 'created_at', ascending: false },
  archivable: true,
});

registerResource({
  path: 'leads',
  table: 'crm_leads',
  select: '*',
  createSchema: leadCreateSchema,
  updateSchema: leadUpdateSchema,
  toRow: leadToRow,
  searchColumns: ['title', 'description', 'lost_reason'],
  orderBy: { column: 'created_at', ascending: false },
  archivable: false,
});

registerResource({
  path: 'jobs',
  table: 'crm_jobs',
  select: '*',
  createSchema: jobCreateSchema,
  updateSchema: jobUpdateSchema,
  toRow: jobToRow,
  searchColumns: ['title', 'claim_number', 'policy_number', 'description'],
  orderBy: { column: 'created_at', ascending: false },
  archivable: false,
});

registerResource({
  path: 'activities',
  table: 'crm_activities',
  select: '*',
  createSchema: activityCreateSchema,
  updateSchema: activityUpdateSchema,
  toRow: activityToRow,
  searchColumns: ['subject', 'body'],
  orderBy: { column: 'occurred_at', ascending: false },
  archivable: false,
});

/* ------------------------------------------------------- extra endpoints */

/**
 * POST /api/crm/leads/:id/convert
 *
 * Turn a won lead into a job, carrying its people, property, and value across
 * so nobody retypes them. The lead is marked won and points at the job it
 * became, which is what makes the sales-to-production handoff auditable later.
 */
crmRouter.post('/leads/:id/convert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const overrides = leadConvertSchema.parse(req.body ?? {});

    const { data: lead, error: leadErr } = await supabase
      .from('crm_leads')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .maybeSingle();

    if (leadErr) throw new HttpError(500, leadErr.message, 'lead_read_failed');
    if (!lead) throw new HttpError(404, 'Lead not found', 'not_found');
    if (lead.converted_job_id) {
      throw new HttpError(409, 'This lead has already been converted.', 'already_converted');
    }

    const workType = overrides.workType ?? lead.work_type;
    if (!workType) {
      throw new HttpError(
        400,
        'Set a work type (mitigation or construction) before converting this lead.',
        'work_type_required',
      );
    }

    const { data: job, error: jobErr } = await supabase
      .from('crm_jobs')
      .insert({
        org_id: orgId,
        created_by: userId,
        lead_id: lead.id,
        contact_id: lead.contact_id,
        account_id: lead.account_id,
        property_id: lead.property_id,
        owner_id: lead.owner_id,
        work_type: workType,
        loss_type: lead.loss_type,
        loss_date: lead.loss_date,
        title: overrides.title ?? lead.title,
        description: lead.description,
        status: overrides.status,
        scheduled_start: overrides.scheduledStart ?? null,
        scheduled_end: overrides.scheduledEnd ?? null,
        contract_amount: overrides.contractAmount ?? lead.estimated_value,
      })
      .select('*')
      .single();

    if (jobErr) throw new HttpError(400, jobErr.message, 'lead_convert_failed');

    // Best-effort: the job exists and is the thing that matters. If this write
    // fails the lead simply stays open, which is visible and fixable — far
    // better than deleting a real job to keep two rows tidy.
    const { error: linkErr } = await supabase
      .from('crm_leads')
      .update({ status: 'won', converted_job_id: job.id })
      .eq('org_id', orgId)
      .eq('id', lead.id);

    res.status(201).json({
      job: camelize(job as Record<string, any>),
      leadUpdated: !linkErr,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/crm/jobs/:id/timeline
 *
 * Everything that has happened on a job, newest first — the question the office
 * asks most often, answered without the caller stitching five requests together.
 */
crmRouter.get('/jobs/:id/timeline', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { limit, offset } = listQuerySchema.parse(req.query);

    const { data, error, count } = await supabase
      .from('crm_activities')
      .select('*, profiles:created_by(email, full_name)', { count: 'exact' })
      .eq('org_id', orgId)
      .eq('job_id', req.params.id)
      .order('occurred_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, error.message, 'timeline_failed');

    res.json({
      items: (data ?? []).map((row) => camelize(row as Record<string, any>)),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/crm/summary
 *
 * Pipeline and workload counts for the dashboard. Head-only count queries, so
 * this stays cheap enough to call on every page load.
 */
crmRouter.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const countOf = async (table: string, filters: Record<string, unknown> = {}) => {
      let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId);
      for (const [column, value] of Object.entries(filters)) q = q.eq(column, value);
      const { count, error } = await q;
      if (error) throw new HttpError(500, error.message, 'summary_failed');
      return count ?? 0;
    };

    const [contacts, properties, openLeads, activeJobs, completedJobs] = await Promise.all([
      countOf('crm_contacts', { is_archived: false }),
      countOf('crm_properties', { is_archived: false }),
      countOf('crm_leads', { status: 'new' }),
      countOf('crm_jobs', { status: 'in_progress' }),
      countOf('crm_jobs', { status: 'completed' }),
    ]);

    res.json({ summary: { contacts, properties, openLeads, activeJobs, completedJobs } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/crm/audit
 *
 * The change ledger for the caller's org: who changed what, when, and what the
 * row looked like before. This is the fine-grained half of our backup story —
 * it is how a single mistakenly deleted customer gets restored without rolling
 * anything else back.
 */
crmRouter.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { table, rowId, since, limit, offset } = auditQuerySchema.parse(req.query);

    let query = supabase
      .from('crm_audit_log')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId);

    if (table) query = query.eq('table_name', table);
    if (rowId) query = query.eq('row_id', rowId);
    if (since) query = query.gte('changed_at', since);

    const { data, error, count } = await query
      .order('changed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, error.message, 'audit_failed');

    res.json({
      entries: (data ?? []).map((row) => camelize(row as Record<string, any>)),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});
