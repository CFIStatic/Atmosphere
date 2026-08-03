import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { requireOrgRole } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import { listGrants, saveGrant, deleteGrant } from '../lib/integrations/oauthVault.js';
import {
  buildMailSender,
  exchangeMailCode,
  mailAuthorizeUrl,
  finaliseBody,
  screenRecipients,
  subjectProblems,
  validatePolicy,
  GmailSender,
  MicrosoftSender,
  MAIL_PROVIDERS,
  type MailSystem,
} from '../campaigns/mail/index.js';
import { buildForecastProvider, FORECAST_PROVIDERS } from '../campaigns/forecast/index.js';
import { findPlaces, PLACE_CATEGORIES, PLACE_ATTRIBUTION } from '../campaigns/places.js';
import {
  activeAlerts,
  alertCoversTerritory,
  hoursOfNotice,
  WEATHER_EVENTS,
  WEATHER_ATTRIBUTION,
} from '../campaigns/weather.js';
import {
  buildAudience,
  decideFires,
  renderTemplate,
  type AudienceConfig,
} from '../campaigns/triggers.js';

// Map and weather services are free, shared, and community- or
// government-run. Staying well inside their limits is a condition of being
// allowed to use them at all, so the ceiling lives here rather than in
// everyone's good intentions.
// Sending is the most consequential thing in this router by a wide margin.
const sendLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sends this hour.', code: 'rate_limited' },
});

const placeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many map or weather lookups. Give it a minute.', code: 'rate_limited' },
});

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
  triggerKind: z.enum(['manual', 'weather', 'seasonal']).optional(),
  triggerConfig: z
    .object({
      groups: z.array(z.string().max(40)).max(10).optional(),
      severities: z.array(z.string().max(20)).max(6).optional(),
      leadTimeHours: z.number().int().min(0).max(240).optional(),
      cooldownDays: z.number().int().min(0).max(365).optional(),
    })
    .optional(),
  audienceConfig: z
    .object({
      placeCategories: z.array(z.string().max(40)).max(12).optional(),
      includeContacts: z.boolean().optional(),
      territoryId: z.string().uuid().nullable().optional(),
      titleKeywords: z.array(z.string().max(60)).max(12).optional(),
    })
    .optional(),
  messageSubject: z.string().max(200).nullable().optional(),
  messageBody: z.string().max(5000).nullable().optional(),
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
        trigger_kind: input.triggerKind ?? 'manual',
        trigger_config: input.triggerConfig ?? {},
        audience_config: input.audienceConfig ?? {},
        message_subject: input.messageSubject ?? null,
        message_body: input.messageBody ?? null,
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
    if (input.triggerKind !== undefined) patch.trigger_kind = input.triggerKind;
    if (input.triggerConfig !== undefined) patch.trigger_config = input.triggerConfig;
    if (input.audienceConfig !== undefined) patch.audience_config = input.audienceConfig;
    if (input.messageSubject !== undefined) patch.message_subject = input.messageSubject;
    if (input.messageBody !== undefined) patch.message_body = input.messageBody;

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

/* ---- Places: the buildings worth selling to ------------------------------ */

const placeSearchSchema = z.object({
  area: z.string().trim().min(2).max(120),
  categories: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  limit: z.number().int().min(1).max(300).optional(),
});

/** GET /api/sales/place-categories — what can be searched for. */
campaignsRouter.get('/place-categories', async (_req: Request, res: Response) => {
  res.json({
    categories: Object.entries(PLACE_CATEGORIES).map(([id, spec]) => ({
      id,
      label: spec.label,
      blurb: spec.blurb,
    })),
    attribution: PLACE_ATTRIBUTION,
  });
});

/**
 * POST /api/sales/places/search
 * Every school / hospital / clinic in an area. Free — this is open map data,
 * not a licensed dataset, so nothing here touches the credit ledger.
 */
campaignsRouter.post(
  '/places/search',
  placeLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await requireOrgContext(req);
      const input = placeSearchSchema.parse(req.body ?? {});
      const result = await findPlaces(input.area, input.categories, input.limit ?? 200);
      res.json({ ...result, attribution: PLACE_ATTRIBUTION });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/sales/places/import — keep the ones worth working. */
campaignsRouter.post('/places/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const input = z
      .object({
        territoryId: z.string().uuid().nullable().optional(),
        places: z
          .array(
            z.object({
              externalId: z.string().min(1).max(120),
              category: z.string().min(1).max(40),
              name: z.string().min(1).max(200),
              street: z.string().max(200).nullable().optional(),
              city: z.string().max(120).nullable().optional(),
              state: z.string().max(60).nullable().optional(),
              postalCode: z.string().max(20).nullable().optional(),
              lat: z.number().nullable().optional(),
              lon: z.number().nullable().optional(),
              phone: z.string().max(60).nullable().optional(),
              website: z.string().max(300).nullable().optional(),
            }),
          )
          .min(1)
          .max(300),
      })
      .parse(req.body ?? {});

    // Upsert, not insert: searching the same area twice is normal, and it
    // should refresh what is there rather than create a second copy of every
    // school in Round Rock.
    const { data, error } = await supabase
      .from('crm_places')
      .upsert(
        input.places.map((p) => ({
          org_id: orgId,
          source: 'osm',
          external_id: p.externalId,
          category: p.category,
          name: p.name,
          street: p.street ?? null,
          city: p.city ?? null,
          state: p.state ?? null,
          postal_code: p.postalCode ?? null,
          lat: p.lat ?? null,
          lon: p.lon ?? null,
          phone: p.phone ?? null,
          website: p.website ?? null,
          territory_id: input.territoryId ?? null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'org_id,source,external_id' },
      )
      .select('id');

    if (error) throw new HttpError(400, error.message, 'place_import_failed');
    res.status(201).json({ imported: data?.length ?? 0 });
  } catch (err) {
    next(err);
  }
});

/** GET /api/sales/places — what this org has kept. */
campaignsRouter.get('/places', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    let query = supabase.from('crm_places').select('*').eq('org_id', orgId).order('name').limit(1000);
    if (typeof req.query.territoryId === 'string') {
      query = query.eq('territory_id', req.query.territoryId);
    }
    if (typeof req.query.category === 'string') query = query.eq('category', req.query.category);

    const { data, error } = await query;
    if (error) throw new HttpError(500, error.message, 'places_failed');
    res.json({ items: (data ?? []).map((r: any) => camel(r)) });
  } catch (err) {
    next(err);
  }
});

/* ---- Weather ------------------------------------------------------------- */

/** GET /api/sales/weather/events — the event groups a campaign can watch. */
campaignsRouter.get('/weather/events', async (_req: Request, res: Response) => {
  res.json({
    groups: Object.entries(WEATHER_EVENTS).map(([id, spec]) => ({
      id,
      label: spec.label,
      blurb: spec.blurb,
      events: spec.events,
    })),
    attribution: WEATHER_ATTRIBUTION,
  });
});

/**
 * GET /api/sales/weather/active?state=TX
 * What the National Weather Service has out right now, annotated with which
 * of this org's territories each alert covers.
 */
campaignsRouter.get(
  '/weather/active',
  placeLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const state = typeof req.query.state === 'string' ? req.query.state : 'TX';

      const [alerts, { data: territories }] = await Promise.all([
        activeAlerts(state),
        supabase.from('crm_territories').select('*').eq('org_id', orgId),
      ]);

      res.json({
        attribution: WEATHER_ATTRIBUTION,
        alerts: alerts.map((alert) => ({
          ...alert,
          hoursOfNotice: hoursOfNotice(alert),
          // The join a salesperson actually cares about: not "is there a
          // storm" but "is there a storm where I sell".
          territories: (territories ?? [])
            .filter((t: any) =>
              alertCoversTerritory(alert, {
                cities: t.cities,
                counties: t.counties,
                postalCodes: t.postal_codes,
              }),
            )
            .map((t: any) => ({ id: t.id, name: t.name })),
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ---- What would fire, and who it would reach ----------------------------- */

/**
 * GET /api/sales/campaigns/pending
 * A dry run: which weather campaigns would go out right now, which would not,
 * and why. Sends nothing.
 *
 * The "why not" half is the point. A campaign that stayed silent through a
 * hail storm is the thing somebody needs explained, and without this the only
 * answer available is a shrug.
 */
campaignsRouter.get(
  '/campaigns/pending',
  placeLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const state = typeof req.query.state === 'string' ? req.query.state : 'TX';

      const [alerts, campaigns, territories, fires] = await Promise.all([
        activeAlerts(state),
        supabase.from('crm_campaigns').select('*').eq('org_id', orgId),
        supabase.from('crm_territories').select('*').eq('org_id', orgId),
        supabase
          .from('crm_campaign_fires')
          .select('campaign_id, alert_id, fired_at')
          .eq('org_id', orgId),
      ]);

      const firedAlertIds = new Set<string>();
      const lastFiredAt = new Map<string, Date>();
      for (const row of (fires.data ?? []) as any[]) {
        if (row.alert_id) firedAlertIds.add(`${row.campaign_id}:${row.alert_id}`);
        const at = new Date(row.fired_at);
        const seen = lastFiredAt.get(row.campaign_id);
        if (!seen || at > seen) lastFiredAt.set(row.campaign_id, at);
      }

      const decision = decideFires({
        campaigns: (campaigns.data ?? []) as any[],
        territories: (territories.data ?? []) as any[],
        alerts,
        firedAlertIds,
        lastFiredAt,
      });

      res.json({ ...decision, alertsSeen: alerts.length });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/sales/campaigns/:id/audience
 * Who this campaign would reach, from its rules rather than a frozen list.
 * The same function answers this and the send path, so a preview of forty
 * cannot become a mailing of four hundred.
 */
campaignsRouter.get(
  '/campaigns/:id/audience',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);

      const { data: campaign, error } = await supabase
        .from('crm_campaigns')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message, 'campaign_read_failed');
      if (!campaign) throw new HttpError(404, 'Campaign not found.', 'not_found');

      const audience = (campaign.audience_config ?? {}) as AudienceConfig;
      const territoryId = audience.territoryId ?? campaign.territory_id ?? null;

      const [contacts, places, territory] = await Promise.all([
        audience.includeContacts
          ? supabase
              // The view, not the table. It filters marketing_opt_out and
              // is_archived structurally — a hand-written column list forgot
              // both, twice, and mailed people who had asked not to be.
              .from('crm_campaign_audience')
              .select('id, first_name, last_name, email, title, company_name, city, postal_code')
              .eq('org_id', orgId)
              .limit(2000)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('crm_places').select('*').eq('org_id', orgId).limit(2000),
        territoryId
          ? supabase.from('crm_territories').select('*').eq('id', territoryId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const members = buildAudience({
        audience: { ...audience, territoryId },
        contacts: (contacts.data ?? []) as any[],
        places: (places.data ?? []) as any[],
        territory: (territory as any).data ?? null,
      });

      res.json({
        members,
        total: members.length,
        contacts: members.filter((m) => m.kind === 'contact').length,
        places: members.filter((m) => m.kind === 'place').length,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/sales/campaigns/:id/preview — render the message for one person. */
campaignsRouter.post(
  '/campaigns/:id/preview',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const vars = z
        .object({
          firstName: z.string().max(80).optional(),
          company: z.string().max(160).optional(),
          event: z.string().max(80).optional(),
          area: z.string().max(160).optional(),
          senderName: z.string().max(80).optional(),
        })
        .parse(req.body ?? {});

      const { data: campaign } = await supabase
        .from('crm_campaigns')
        .select('message_subject, message_body')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();
      if (!campaign) throw new HttpError(404, 'Campaign not found.', 'not_found');

      res.json({
        subject: renderTemplate(campaign.message_subject ?? '', vars),
        body: renderTemplate(campaign.message_body ?? '', vars),
      });
    } catch (err) {
      next(err);
    }
  },
);

/* ---- Connecting a mailbox, and sending from it --------------------------- */

const mailStates = new Map<string, { orgId: string; userId: string; expiresAt: number }>();

function newMailState(orgId: string, userId: string): string {
  const now = Date.now();
  for (const [k, v] of mailStates) if (v.expiresAt < now) mailStates.delete(k);
  const state = randomBytes(24).toString('base64url');
  mailStates.set(state, { orgId, userId, expiresAt: now + 10 * 60_000 });
  return state;
}

function mailRedirectUri(): string {
  return `${config.frontendOrigins[0]}/settings?section=sending`;
}

/** GET /api/sales/mail — which mailbox is connected, and what it can do. */
campaignsRouter.get('/mail', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const connected = config.integrations.oauthKey
      ? (await listGrants(orgId)).filter((g) => g.system.endsWith('_mail'))
      : [];

    const { data: policy } = await supabase
      .from('crm_send_policy')
      .select('*')
      .eq('org_id', orgId)
      .maybeSingle();

    // How many went out today, so the UI can show the headroom rather than
    // letting somebody discover the ceiling half way through a campaign.
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('crm_sends')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('state', 'sent')
      .gte('sent_at', since.toISOString());

    res.json({
      providers: MAIL_PROVIDERS,
      connected,
      policy: policy ? camel(policy) : null,
      sentToday: count ?? 0,
      vaultConfigured: Boolean(config.integrations.oauthKey),
    });
  } catch (err) {
    next(err);
  }
});

/** POST /api/sales/mail/:system/connect */
campaignsRouter.post('/mail/:system/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId } = await requireOrgRole(req, ['owner', 'admin']);
    const system = req.params.system as MailSystem;
    if (system !== 'google_mail' && system !== 'microsoft_mail') {
      throw new HttpError(400, 'Unknown mail provider.', 'unknown_provider');
    }
    if (!config.integrations.oauthKey) {
      throw new HttpError(
        503,
        'Connecting a mailbox needs INTEGRATIONS_OAUTH_KEY so the grant can be encrypted at rest.',
        'vault_not_configured',
      );
    }
    const configured =
      system === 'google_mail' ? config.campaigns.googleClientId : config.campaigns.microsoftClientId;
    if (!configured) {
      throw new HttpError(503, 'That provider is not configured on this deployment.', 'not_configured');
    }

    res.json({ url: mailAuthorizeUrl(system, newMailState(orgId, userId), mailRedirectUri()) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/sales/mail/:system/callback */
campaignsRouter.post('/mail/:system/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requireOrgRole(req, ['owner', 'admin']);
    const system = req.params.system as MailSystem;
    const { code, state } = z
      .object({ code: z.string().min(1), state: z.string().min(1) })
      .parse(req.body ?? {});

    const pending = mailStates.get(state);
    mailStates.delete(state);
    if (!pending || pending.expiresAt < Date.now()) {
      throw new HttpError(400, 'That authorization has expired. Start again.', 'state_expired');
    }

    const { refreshToken, accessToken } = await exchangeMailCode(system, code, mailRedirectUri());

    // Ask who this actually is before storing anything, so the UI can show the
    // address that mail will come from rather than "connected".
    const sender =
      system === 'google_mail' ? new GmailSender(accessToken) : new MicrosoftSender(accessToken);
    const identity = await sender.identity();

    await saveGrant(pending.orgId, pending.userId, {
      system,
      refreshToken,
      instanceUrl: '',
      accountLabel: identity.address,
    });

    res.json({ connected: true, address: identity.address, provider: identity.provider });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/sales/mail/:system */
campaignsRouter.delete('/mail/:system', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = await requireOrgRole(req, ['owner', 'admin']);
    await deleteGrant(orgId, req.params.system);
    res.json({ disconnected: true });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/sales/send-policy — the address and caps every send needs. */
campaignsRouter.put('/send-policy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgRole(req, ['owner', 'admin']);
    const input = z
      .object({
        postalAddress: z.string().trim().max(300).nullable().optional(),
        replyTo: z.string().trim().email().max(200).nullable().optional(),
        maxRecipients: z.number().int().min(1).max(5000).optional(),
        dailyCeiling: z.number().int().min(1).max(10000).optional(),
      })
      .parse(req.body ?? {});

    const { data, error } = await supabase
      .from('crm_send_policy')
      .upsert(
        {
          org_id: orgId,
          postal_address: input.postalAddress ?? null,
          reply_to: input.replyTo ?? null,
          ...(input.maxRecipients !== undefined ? { max_recipients: input.maxRecipients } : {}),
          ...(input.dailyCeiling !== undefined ? { daily_ceiling: input.dailyCeiling } : {}),
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id' },
      )
      .select('*')
      .single();
    if (error) throw new HttpError(400, error.message, 'policy_save_failed');
    res.json({ policy: camel(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sales/campaigns/:id/send
 *
 * Dry run unless `confirm: true`. That default is the point: a weather
 * campaign's audience is a rule rather than a list, so the only way to know
 * who it reaches today is to ask — and finding out by sending is not a plan.
 *
 * The screening is identical either way. A preview that used different logic
 * from the send would be worse than no preview at all.
 */
campaignsRouter.post(
  '/campaigns/:id/send',
  sendLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgRole(req, ['owner', 'admin']);
      const { confirm, event, area } = z
        .object({
          confirm: z.boolean().optional(),
          event: z.string().max(80).optional(),
          area: z.string().max(160).optional(),
        })
        .parse(req.body ?? {});

      const { data: campaign } = await supabase
        .from('crm_campaigns')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();
      if (!campaign) throw new HttpError(404, 'Campaign not found.', 'not_found');
      if (!campaign.message_subject || !campaign.message_body) {
        throw new HttpError(400, 'Write the message before sending it.', 'no_message');
      }

      const { data: policyRow } = await supabase
        .from('crm_send_policy')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle();

      const policy = {
        postalAddress: policyRow?.postal_address ?? '',
        // The backend handler, not the app: the person clicking has no
        // account. Pointing this at the SPA shipped a dead opt-out link in
        // every message.
        unsubscribeUrl: config.campaigns.unsubscribeBaseUrl,
        maxRecipients: policyRow?.max_recipients ?? 200,
        dailyCeiling: policyRow?.daily_ceiling ?? 300,
      };

      // Refuse before the first message rather than discovering it after four
      // hundred: a campaign missing its postal address has already committed
      // the violation four hundred times by then.
      const problems = [...validatePolicy(policy), ...subjectProblems(campaign.message_subject)];
      // Subject checks are advisory on a dry run and blocking on a real send.
      // "Warn the operator" is not a control on a path where the point is that
      // no operator is watching — and a deceptive subject is the specific thing
      // CAN-SPAM prohibits.
      const blocking = [
        ...validatePolicy(policy),
        ...(confirm ? subjectProblems(campaign.message_subject) : []),
      ];
      if (blocking.length) {
        throw new HttpError(400, blocking.join(' '), 'policy_incomplete');
      }

      // Audience from the same builder the preview endpoint uses.
      const audienceCfg = (campaign.audience_config ?? {}) as AudienceConfig;
      const territoryId = audienceCfg.territoryId ?? campaign.territory_id ?? null;
      const [contactsRes, placesRes, territoryRes] = await Promise.all([
        audienceCfg.includeContacts
          ? supabase
              // The view, not the table. It filters marketing_opt_out and
              // is_archived structurally — a hand-written column list forgot
              // both, twice, and mailed people who had asked not to be.
              .from('crm_campaign_audience')
              .select('id, first_name, last_name, email, title, company_name, city, postal_code')
              .eq('org_id', orgId)
              .limit(2000)
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('crm_places').select('*').eq('org_id', orgId).limit(2000),
        territoryId
          ? supabase.from('crm_territories').select('*').eq('id', territoryId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const members = buildAudience({
        audience: { ...audienceCfg, territoryId },
        contacts: (contactsRes.data ?? []) as any[],
        places: (placesRes.data ?? []) as any[],
        territory: (territoryRes as any).data ?? null,
      });

      // The sender is resolved before screening, not after, so its own daily
      // ceiling can bound the budget. Previously the Gmail and Microsoft
      // ceilings were declared and never read — screening had already decided
      // how many to send before anybody asked what the mailbox would accept.
      const sender = confirm ? await buildMailSender(orgId) : null;
      if (confirm && !sender) {
        throw new HttpError(400, 'Connect a mailbox before sending.', 'no_mailbox');
      }

      // Everything the gate needs, loaded once.
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const [supp, unsub, priorSends, todayCount] = await Promise.all([
        supabase.from('crm_suppressions').select('kind, value').eq('org_id', orgId),
        supabase.from('crm_unsubscribes').select('email').eq('org_id', orgId),
        supabase.from('crm_sends').select('email, state').eq('org_id', orgId).eq('campaign_id', req.params.id),
        supabase
          .from('crm_sends')
          .select('id', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('state', 'sent')
          .gte('sent_at', since.toISOString()),
      ]);

      // Global erasure tombstones, read once. They outrank every other list
      // and they cross org boundaries — somebody who asked to be forgotten
      // stays forgotten regardless of which customer holds their address.
      const admin = createAdminClient();
      const erasedEmails = new Set<string>();
      if (admin) {
        const { data: erased } = await admin.from('network_erasures').select('email');
        for (const row of (erased ?? []) as any[]) {
          erasedEmails.add(String(row.email).toLowerCase());
        }
      }

      const suppressedEmails = new Set<string>();
      const suppressedDomains = new Set<string>();
      for (const row of (supp.data ?? []) as any[]) {
        const v = String(row.value ?? '').toLowerCase();
        if (row.kind === 'email') suppressedEmails.add(v);
        if (row.kind === 'domain') suppressedDomains.add(v);
      }

      const screened = screenRecipients({
        recipients: members
          .filter((m) => m.email)
          .map((m) => ({ email: m.email as string, name: m.name, company: m.company })),
        suppressedEmails,
        suppressedDomains,
        erasedEmails,
        unsubscribed: new Set(((unsub.data ?? []) as any[]).map((r) => String(r.email).toLowerCase())),
        alreadySent: new Set(
          ((priorSends.data ?? []) as any[])
            .filter((r) => r.state === 'sent')
            .map((r) => String(r.email).toLowerCase()),
        ),
        hardBounced: new Set(
          ((priorSends.data ?? []) as any[])
            .filter((r) => r.state === 'bounced')
            .map((r) => String(r.email).toLowerCase()),
        ),
        policy: {
          ...policy,
          // The lowest of the three: what the customer set, and what the
          // mailbox provider will actually accept. Exceeding a provider's
          // limit gets the mailbox locked, which costs the customer their
          // email rather than costing us a campaign.
          dailyCeiling: Math.min(policy.dailyCeiling, sender?.dailyCeiling ?? policy.dailyCeiling),
        },
        sentToday: todayCount.count ?? 0,
      });

      if (!confirm) {
        // The dry run. Same screening, nothing sent, and the blocked list with
        // reasons is the useful half.
        res.json({
          dryRun: true,
          wouldSend: screened.send.length,
          blocked: screened.blocked,
          warnings: problems,
          from: null,
          sample: renderTemplate(campaign.message_body, {
            firstName: screened.send[0]?.name?.split(' ')[0] ?? null,
            company: screened.send[0]?.company ?? null,
            event: event ?? null,
            area: area ?? null,
          }),
        });
        return;
      }

      const identity = await sender!.identity();

      let sent = 0;
      const failures: Array<{ email: string; error: string }> = [];
      const sendSpacingMs = config.campaigns.sendSpacingMs;

      for (const recipient of screened.send) {
        // The row is written first so the unique index on (fire_id, email) is
        // what prevents a double send, rather than hoping the loop runs once.
        const { data: row, error: rowError } = await supabase
          .from('crm_sends')
          .insert({
            org_id: orgId,
            campaign_id: req.params.id,
            email: recipient.email,
            subject: campaign.message_subject,
            state: 'queued',
          })
          .select('id, unsubscribe_token')
          .single();
        if (rowError || !row) continue;

        const body = finaliseBody(
          renderTemplate(campaign.message_body, {
            firstName: recipient.name?.split(' ')[0] ?? null,
            company: recipient.company ?? null,
            event: event ?? null,
            area: area ?? null,
            senderName: identity.displayName,
          }),
          policy,
          row.unsubscribe_token,
        );

        const unsubscribeUrl = `${policy.unsubscribeUrl}${policy.unsubscribeUrl.includes('?') ? '&' : '?'}t=${encodeURIComponent(row.unsubscribe_token)}`;

        const result = await sender!.send({
          to: recipient.email,
          toName: recipient.name ?? null,
          subject: renderTemplate(campaign.message_subject, { event: event ?? null, area: area ?? null }),
          text: body,
          replyTo: policyRow?.reply_to ?? null,
          // One-click unsubscribe turns "reported as spam" into "removed",
          // which is the difference between a complaint that damages the
          // customer's domain and one that does not.
          unsubscribe: { url: unsubscribeUrl },
          sendId: row.id,
        });

        await supabase
          .from('crm_sends')
          .update({
            state: result.ok ? 'sent' : 'failed',
            provider_message_id: result.messageId,
            error: result.error ?? null,
            sent_at: result.ok ? new Date().toISOString() : null,
          })
          .eq('id', row.id);

        if (result.ok) sent += 1;
        else failures.push({ email: recipient.email, error: result.error ?? 'unknown' });

        // Exchange Online caps a mailbox at 30 messages a minute and it is not
        // raisable; Graph additionally allows four concurrent per mailbox. An
        // unpaced loop trips both and the customer's mailbox gets throttled
        // mid-campaign. Two seconds between messages sits inside every
        // provider's limit and nobody is waiting on this.
        if (screened.send.length > 1) {
          await new Promise((r) => setTimeout(r, sendSpacingMs));
        }
      }

      res.json({
        dryRun: false,
        sent,
        blocked: screened.blocked,
        failures,
        from: identity.address,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/sales/forecast?lat=&lon=&hourly=
 * Several days ahead for one point, so a salesperson can see the storm before
 * anybody issues a warning about it.
 */
campaignsRouter.get('/forecast', placeLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await requireOrgContext(req);
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new HttpError(400, 'A latitude and longitude are needed.', 'bad_point');
    }

    const provider = buildForecastProvider();
    const forecast =
      req.query.hourly === '1' ? await provider.hourly(lat, lon) : await provider.daily(lat, lon);
    if (!forecast) {
      throw new HttpError(502, 'No forecast is available for that location.', 'no_forecast');
    }
    res.json(forecast);
  } catch (err) {
    next(err);
  }
});

/** GET /api/sales/forecast-providers — what could answer, and what it costs. */
campaignsRouter.get('/forecast-providers', async (_req: Request, res: Response) => {
  res.json({ providers: FORECAST_PROVIDERS, active: buildForecastProvider().name });
});
