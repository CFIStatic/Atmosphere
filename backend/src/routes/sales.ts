import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import { emailDeliveryEnabled } from '../sales/email.js';
import {
  DEFAULT_SALES_FOCUS,
  DEFAULT_SENDER_NAME,
  DEFAULT_VALUE_PROP,
  resolveCampaignMessaging,
} from '../sales/atmosphereProduct.js';
import {
  createCampaignSchema,
  updateCampaignSchema,
  replySchema,
  peopleSearchSchema,
} from '../sales/validation.js';
import {
  serializeCampaign,
  serializeBusiness,
  serializeContact,
  serializeOutreach,
  serializeMeeting,
  serializeEvent,
  serializePeopleSearch,
  logSalesEvent,
} from '../sales/serialize.js';
import { runCampaign, handleInboundReply, isCampaignRunning } from '../sales/runner.js';
import { runPeopleSearch } from '../sales/peopleSearch.js';

export const salesRouter = Router();
salesRouter.use(requireAuth);

const startLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many campaign starts, slow down.', code: 'rate_limited' } },
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many people searches, slow down.', code: 'rate_limited' } },
});

function mapZod(err: unknown, next: NextFunction) {
  if (err instanceof ZodError) {
    next(new HttpError(400, err.errors[0]?.message ?? 'Invalid input', 'validation_error'));
    return;
  }
  next(err);
}

/** GET /api/sales/status */
salesRouter.get('/status', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      status: {
        llm: Boolean(config.anthropic.apiKey),
        email: emailDeliveryEnabled(),
        demoMode:
          process.env.SALES_DEMO_MODE === 'true' || process.env.SALES_DEMO_MODE === '1',
        crawl: true,
        scheduling: true,
        peopleSearch: true,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** GET /api/sales/campaigns */
salesRouter.get('/campaigns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('sales_campaigns')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new HttpError(500, error.message, 'sales_list_failed');
    res.json({ campaigns: (data ?? []).map((row) => serializeCampaign(row)) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/sales/campaigns */
salesRouter.post('/campaigns', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createCampaignSchema.parse(req.body);
    const { orgId, userId, supabase } = await requireOrgContext(req);

    const messaging = resolveCampaignMessaging({
      salesFocus: body.salesFocus,
      valueProp: body.valueProp,
      senderName: body.senderName,
    });
    const name =
      body.name?.trim() ||
      `Atmosphere outreach · ${messaging.salesFocus.trim()} · ${body.territory.trim()}`.slice(0, 200);

    const { data, error } = await supabase
      .from('sales_campaigns')
      .insert({
        org_id: orgId,
        created_by: userId,
        name,
        territory: body.territory,
        sales_focus: messaging.salesFocus,
        value_prop: messaging.valueProp || DEFAULT_VALUE_PROP,
        sender_name: messaging.senderName || DEFAULT_SENDER_NAME,
        sender_email: body.senderEmail ?? null,
        meeting_duration_min: body.meetingDurationMin ?? 45,
        availability: body.availability ?? {
          mon: ['09:00-12:00', '13:00-17:00'],
          tue: ['09:00-12:00', '13:00-17:00'],
          wed: ['09:00-12:00', '13:00-17:00'],
          thu: ['09:00-12:00', '13:00-17:00'],
          fri: ['09:00-12:00', '13:00-16:00'],
        },
        status: 'draft',
      })
      .select('*')
      .single();

    if (error || !data) throw new HttpError(500, error?.message ?? 'Could not create campaign', 'sales_create_failed');

    await logSalesEvent(supabase, {
      orgId,
      campaignId: data.id,
      actorType: 'user',
      eventType: 'campaign_created',
      detail: `Atmosphere outreach campaign for ${body.territory} / ${messaging.salesFocus || DEFAULT_SALES_FOCUS}.`,
    });

    res.status(201).json({ campaign: serializeCampaign(data) });
  } catch (err) {
    mapZod(err, next);
  }
});

/** GET /api/sales/campaigns/:id */
salesRouter.get('/campaigns/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('sales_campaigns')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'sales_get_failed');
    if (!data) throw new HttpError(404, 'Campaign not found', 'not_found');
    res.json({
      campaign: serializeCampaign(data),
      running: isCampaignRunning(data.id),
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/sales/campaigns/:id */
salesRouter.patch('/campaigns/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateCampaignSchema.parse(req.body);
    const { orgId, supabase } = await requireOrgContext(req);

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.territory !== undefined) patch.territory = body.territory;
    if (body.salesFocus !== undefined) patch.sales_focus = body.salesFocus;
    if (body.valueProp !== undefined) patch.value_prop = body.valueProp;
    if (body.senderName !== undefined) patch.sender_name = body.senderName;
    if (body.senderEmail !== undefined) patch.sender_email = body.senderEmail;
    if (body.meetingDurationMin !== undefined) patch.meeting_duration_min = body.meetingDurationMin;
    if (body.availability !== undefined) patch.availability = body.availability;
    if (body.status !== undefined) patch.status = body.status;

    const { data, error } = await supabase
      .from('sales_campaigns')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();

    if (error) throw new HttpError(500, error.message, 'sales_update_failed');
    if (!data) throw new HttpError(404, 'Campaign not found', 'not_found');
    res.json({ campaign: serializeCampaign(data) });
  } catch (err) {
    mapZod(err, next);
  }
});

/** POST /api/sales/campaigns/:id/start */
salesRouter.post(
  '/campaigns/:id/start',
  startLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const { data, error } = await supabase
        .from('sales_campaigns')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message, 'sales_get_failed');
      if (!data) throw new HttpError(404, 'Campaign not found', 'not_found');

      if (isCampaignRunning(data.id)) {
        res.json({ campaign: serializeCampaign(data), running: true });
        return;
      }

      // Fire and forget — the UI polls campaign detail for progress.
      void runCampaign({
        accessToken: req.accessToken!,
        orgId,
        userId,
        campaignId: data.id,
      });

      res.status(202).json({
        campaign: serializeCampaign({ ...data, status: 'researching' }),
        running: true,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** POST /api/sales/campaigns/:id/pause */
salesRouter.post('/campaigns/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('sales_campaigns')
      .update({ status: 'paused', stage_detail: 'Paused by user.' })
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'sales_pause_failed');
    if (!data) throw new HttpError(404, 'Campaign not found', 'not_found');
    await logSalesEvent(supabase, {
      orgId,
      campaignId: data.id,
      actorType: 'user',
      eventType: 'campaign_paused',
      detail: 'Campaign paused.',
    });
    res.json({ campaign: serializeCampaign(data) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/sales/campaigns/:id/resume */
salesRouter.post(
  '/campaigns/:id/resume',
  startLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const { data, error } = await supabase
        .from('sales_campaigns')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();
      if (error) throw new HttpError(500, error.message, 'sales_get_failed');
      if (!data) throw new HttpError(404, 'Campaign not found', 'not_found');

      await supabase
        .from('sales_campaigns')
        .update({ status: 'following_up', stage_detail: 'Resuming follow-ups…' })
        .eq('id', data.id);

      void runCampaign({
        accessToken: req.accessToken!,
        orgId,
        userId,
        campaignId: data.id,
      });

      res.status(202).json({ campaign: serializeCampaign({ ...data, status: 'following_up' }), running: true });
    } catch (err) {
      next(err);
    }
  },
);

async function listChild(
  req: Request,
  res: Response,
  next: NextFunction,
  table: string,
  serialize: (row: Record<string, unknown>) => unknown,
  key: string,
) {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('org_id', orgId)
      .eq('campaign_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw new HttpError(500, error.message, 'sales_list_failed');
    res.json({ [key]: (data ?? []).map((row) => serialize(row)) });
  } catch (err) {
    next(err);
  }
}

salesRouter.get('/campaigns/:id/businesses', (req, res, next) =>
  listChild(req, res, next, 'sales_businesses', serializeBusiness, 'businesses'),
);
salesRouter.get('/campaigns/:id/contacts', (req, res, next) =>
  listChild(req, res, next, 'sales_contacts', serializeContact, 'contacts'),
);
salesRouter.get('/campaigns/:id/outreach', (req, res, next) =>
  listChild(req, res, next, 'sales_outreach', serializeOutreach, 'outreach'),
);
salesRouter.get('/campaigns/:id/meetings', (req, res, next) =>
  listChild(req, res, next, 'sales_meetings', serializeMeeting, 'meetings'),
);
salesRouter.get('/campaigns/:id/events', (req, res, next) =>
  listChild(req, res, next, 'sales_events', serializeEvent, 'events'),
);

/** POST /api/sales/outreach/:id/reply — record an inbound reply (or simulate one). */
salesRouter.post('/outreach/:id/reply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = replySchema.parse(req.body);
    const { orgId } = await requireOrgContext(req);
    const result = await handleInboundReply({
      accessToken: req.accessToken!,
      orgId,
      outreachId: req.params.id,
      body: body.body,
      subject: body.subject,
    });
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'Outreach message not found') {
      next(new HttpError(404, err.message, 'not_found'));
      return;
    }
    mapZod(err, next);
  }
});

/** POST /api/sales/meetings/:id/confirm */
salesRouter.post('/meetings/:id/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('sales_meetings')
      .update({ status: 'confirmed' })
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .select('*')
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'sales_meeting_failed');
    if (!data) throw new HttpError(404, 'Meeting not found', 'not_found');
    res.json({ meeting: serializeMeeting(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sales/people-search
 * Natural-language lookup: "director of facilities at ABC Supply in Milwaukee".
 * Crawls the public web, extracts candidates with sources, and persists the run.
 */
salesRouter.post(
  '/people-search',
  searchLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = peopleSearchSchema.parse(req.body);
      const { orgId, userId, supabase } = await requireOrgContext(req);

      const result = await runPeopleSearch(body.query);

      const { data, error } = await supabase
        .from('sales_people_searches')
        .insert({
          org_id: orgId,
          created_by: userId,
          query: body.query,
          parsed: result.query,
          status: result.status,
          summary: result.summary,
          best_match: result.bestMatch,
          candidates: result.candidates,
          sources: result.sourcesCrawled,
          trace: result.trace,
          pages_crawled: result.pagesCrawled,
          searches_run: result.searchesRun,
          duration_ms: result.durationMs,
        })
        .select('*')
        .single();

      // Persistence is best-effort — still return the live result if the table
      // has not been migrated yet.
      if (error) {
        res.status(200).json({
          search: {
            id: null,
            query: body.query,
            parsed: result.query,
            status: result.status,
            summary: result.summary,
            bestMatch: result.bestMatch,
            candidates: result.candidates,
            sources: result.sourcesCrawled,
            trace: result.trace,
            pagesCrawled: result.pagesCrawled,
            searchesRun: result.searchesRun,
            durationMs: result.durationMs,
            error: null,
            createdAt: new Date().toISOString(),
            persisted: false,
            persistError: error.message,
          },
        });
        return;
      }

      res.status(201).json({
        search: { ...serializePeopleSearch(data), persisted: true },
      });
    } catch (err) {
      mapZod(err, next);
    }
  },
);

/** GET /api/sales/people-search — recent lookups for this org */
salesRouter.get('/people-search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('sales_people_searches')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw new HttpError(500, error.message, 'sales_search_list_failed');
    res.json({ searches: (data ?? []).map((row) => serializePeopleSearch(row)) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/sales/people-search/:id */
salesRouter.get('/people-search/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('sales_people_searches')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'sales_search_get_failed');
    if (!data) throw new HttpError(404, 'Search not found', 'not_found');
    res.json({ search: serializePeopleSearch(data) });
  } catch (err) {
    next(err);
  }
});
