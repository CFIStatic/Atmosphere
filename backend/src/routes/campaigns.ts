import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';

/**
 * Campaigns and territories — the two things the pipeline cannot express.
 *
 * A lead answers "what is happening with this opportunity". Neither of these
 * is an opportunity: a territory is a standing claim on a patch of the world
 * that exists before any lead in it and outlives all of them, and a campaign
 * is a sequence of touches aimed at people most of whom have no lead at all.
 *
 * Both are plain org-scoped CRUD. What little logic there is lives in the
 * counts — a campaign without its member tally is a name on a screen, and the
 * whole reason to open this page is to see whether anybody replied.
 */
export const campaignsRouter = Router();

campaignsRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

function camel(row: Record<string, any> | null): Record<string, any> | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out;
}

const areaList = z.array(z.string().trim().min(1).max(60)).max(200).optional();

const territorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  postalCodes: areaList,
  cities: areaList,
  counties: areaList,
  active: z.boolean().optional(),
});

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(160),
  goal: z.string().trim().max(1000).nullable().optional(),
  channel: z.enum(['email', 'call', 'mixed']).optional(),
  status: z.enum(['draft', 'active', 'paused', 'finished']).optional(),
  territoryId: z.string().uuid().nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  startsOn: z.string().date().nullable().optional(),
  endsOn: z.string().date().nullable().optional(),
});

const memberSchema = z
  .object({
    contactId: z.string().uuid().optional(),
    prospectId: z.string().uuid().optional(),
    note: z.string().trim().max(500).optional(),
  })
  // The table enforces this too; catching it here gives a readable message
  // instead of a constraint violation.
  .refine((v) => v.contactId || v.prospectId, {
    message: 'A campaign member is a contact or a prospect.',
  });

const memberUpdateSchema = z.object({
  status: z.enum(['pending', 'sent', 'opened', 'replied', 'bounced', 'unsubscribed', 'skipped']),
  note: z.string().trim().max(500).optional(),
});

/* ---- Territories --------------------------------------------------------- */

campaignsRouter.get('/territories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('crm_territories')
      .select('*')
      .eq('org_id', orgId)
      .order('name');
    if (error) throw new HttpError(500, error.message, 'territories_failed');
    res.json({ items: (data ?? []).map((r: any) => camel(r)) });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post('/territories', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = territorySchema.parse(req.body ?? {});

    const { data, error } = await supabase
      .from('crm_territories')
      .insert({
        org_id: orgId,
        created_by: userId,
        name: input.name,
        description: input.description ?? null,
        owner_id: input.ownerId ?? null,
        postal_codes: input.postalCodes ?? [],
        cities: input.cities ?? [],
        counties: input.counties ?? [],
        active: input.active ?? true,
      })
      .select('*')
      .single();

    if (error) {
      // The unique index is doing real work here: two territories both
      // believing they own Austin is exactly the confusion this prevents.
      if (error.code === '23505') {
        throw new HttpError(409, 'A territory with that name already exists.', 'duplicate_name');
      }
      throw new HttpError(400, error.message, 'territory_create_failed');
    }
    res.status(201).json({ item: camel(data) });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.patch('/territories/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const input = territorySchema.partial().parse(req.body ?? {});

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.ownerId !== undefined) patch.owner_id = input.ownerId;
    if (input.postalCodes !== undefined) patch.postal_codes = input.postalCodes;
    if (input.cities !== undefined) patch.cities = input.cities;
    if (input.counties !== undefined) patch.counties = input.counties;
    if (input.active !== undefined) patch.active = input.active;

    const { data, error } = await supabase
      .from('crm_territories')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message, 'territory_update_failed');
    res.json({ item: camel(data) });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.delete('/territories/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { error } = await supabase
      .from('crm_territories')
      .delete()
      .eq('org_id', orgId)
      .eq('id', req.params.id);
    if (error) throw new HttpError(400, error.message, 'territory_delete_failed');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---- Campaigns ----------------------------------------------------------- */

campaignsRouter.get('/campaigns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const [{ data: campaigns, error }, { data: members }] = await Promise.all([
      supabase
        .from('crm_campaigns')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false }),
      supabase.from('crm_campaign_members').select('campaign_id, status').eq('org_id', orgId),
    ]);
    if (error) throw new HttpError(500, error.message, 'campaigns_failed');

    // Tallied here rather than per-campaign: one extra query for the whole
    // page instead of one per row, and the page is useless without the counts.
    const tally = new Map<string, Record<string, number>>();
    for (const m of members ?? []) {
      const bucket = tally.get(m.campaign_id) ?? {};
      bucket[m.status] = (bucket[m.status] ?? 0) + 1;
      bucket.total = (bucket.total ?? 0) + 1;
      tally.set(m.campaign_id, bucket);
    }

    res.json({
      items: (campaigns ?? []).map((c: any) => ({
        ...camel(c),
        counts: tally.get(c.id) ?? { total: 0 },
      })),
    });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.post('/campaigns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = campaignSchema.parse(req.body ?? {});

    const { data, error } = await supabase
      .from('crm_campaigns')
      .insert({
        org_id: orgId,
        created_by: userId,
        name: input.name,
        goal: input.goal ?? null,
        channel: input.channel ?? 'email',
        status: input.status ?? 'draft',
        territory_id: input.territoryId ?? null,
        owner_id: input.ownerId ?? null,
        starts_on: input.startsOn ?? null,
        ends_on: input.endsOn ?? null,
      })
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message, 'campaign_create_failed');
    res.status(201).json({ item: { ...camel(data), counts: { total: 0 } } });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.patch('/campaigns/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const input = campaignSchema.partial().parse(req.body ?? {});

    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.goal !== undefined) patch.goal = input.goal;
    if (input.channel !== undefined) patch.channel = input.channel;
    if (input.status !== undefined) patch.status = input.status;
    if (input.territoryId !== undefined) patch.territory_id = input.territoryId;
    if (input.ownerId !== undefined) patch.owner_id = input.ownerId;
    if (input.startsOn !== undefined) patch.starts_on = input.startsOn;
    if (input.endsOn !== undefined) patch.ends_on = input.endsOn;

    const { data, error } = await supabase
      .from('crm_campaigns')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message, 'campaign_update_failed');
    res.json({ item: camel(data) });
  } catch (err) {
    next(err);
  }
});

campaignsRouter.delete('/campaigns/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { error } = await supabase
      .from('crm_campaigns')
      .delete()
      .eq('org_id', orgId)
      .eq('id', req.params.id);
    if (error) throw new HttpError(400, error.message, 'campaign_delete_failed');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---- Campaign members ---------------------------------------------------- */

campaignsRouter.get(
  '/campaigns/:id/members',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { data, error } = await supabase
        .from('crm_campaign_members')
        .select('*, crm_contacts(first_name, last_name, email, company_name), crm_prospects(full_name, email, company_name)')
        .eq('org_id', orgId)
        .eq('campaign_id', req.params.id)
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw new HttpError(500, error.message, 'members_failed');

      res.json({
        items: (data ?? []).map((row: any) => {
          const contact = row.crm_contacts;
          const prospect = row.crm_prospects;
          const name = contact
            ? [contact.first_name, contact.last_name].filter(Boolean).join(' ')
            : (prospect?.full_name ?? 'Unknown');
          return {
            ...camel({ ...row, crm_contacts: undefined, crm_prospects: undefined }),
            personName: name,
            personEmail: contact?.email ?? prospect?.email ?? null,
            personCompany: contact?.company_name ?? prospect?.company_name ?? null,
          };
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

campaignsRouter.post(
  '/campaigns/:id/members',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const input = memberSchema.parse(req.body ?? {});

      const { data, error } = await supabase
        .from('crm_campaign_members')
        .insert({
          org_id: orgId,
          campaign_id: req.params.id,
          contact_id: input.contactId ?? null,
          prospect_id: input.prospectId ?? null,
          note: input.note ?? null,
        })
        .select('*')
        .single();

      if (error) {
        // Adding the same person twice is a slip, not a failure worth an
        // opaque error — the partial unique indexes catch it either way.
        if (error.code === '23505') {
          throw new HttpError(409, 'They are already in this campaign.', 'already_member');
        }
        throw new HttpError(400, error.message, 'member_add_failed');
      }
      res.status(201).json({ item: camel(data) });
    } catch (err) {
      next(err);
    }
  },
);

campaignsRouter.patch(
  '/campaigns/:id/members/:memberId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const input = memberUpdateSchema.parse(req.body ?? {});

      const patch: Record<string, any> = {
        status: input.status,
        updated_at: new Date().toISOString(),
      };
      if (input.note !== undefined) patch.note = input.note;
      // Anything that is not still pending has been touched, and the timestamp
      // is what makes "nobody has followed up in two weeks" answerable.
      if (input.status !== 'pending') patch.last_touch_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('crm_campaign_members')
        .update(patch)
        .eq('org_id', orgId)
        .eq('campaign_id', req.params.id)
        .eq('id', req.params.memberId)
        .select('*')
        .single();
      if (error) throw new HttpError(400, error.message, 'member_update_failed');
      res.json({ item: camel(data) });
    } catch (err) {
      next(err);
    }
  },
);

campaignsRouter.delete(
  '/campaigns/:id/members/:memberId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { error } = await supabase
        .from('crm_campaign_members')
        .delete()
        .eq('org_id', orgId)
        .eq('campaign_id', req.params.id)
        .eq('id', req.params.memberId);
      if (error) throw new HttpError(400, error.message, 'member_remove_failed');
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
