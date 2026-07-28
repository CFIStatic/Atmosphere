/**
 * Email Marketing routes — CRM map, storm scan, outreach, check-ins.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { currentEmailProvider, sendMarketingEmail } from '../emailMarketing/email.js';
import { matchContactsToStorm } from '../emailMarketing/match.js';
import {
  camelize,
  getOrCreateSettings,
  loadMapContacts,
  recordCrmEmailActivity,
  stormToFootprint,
  upsertStorms,
} from '../emailMarketing/store.js';
import {
  buildTemplateContext,
  defaultCheckinTemplates,
  defaultStormTemplates,
  renderStormEmail,
} from '../emailMarketing/templates.js';
import {
  checkinUpdateSchema,
  createOutreachSchema,
  listQuerySchema,
  messageUpdateSchema,
  scheduleCheckinsSchema,
  settingsUpdateSchema,
  stormScanSchema,
} from '../emailMarketing/validation.js';
import { fetchWeatherAlerts } from '../emailMarketing/weather.js';
import { HttpError } from '../lib/errors.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { requireAuth } from '../middleware/requireAuth.js';

export const emailMarketingRouter = Router();

emailMarketingRouter.use(requireAuth);

const scanLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many weather scans. Wait a moment.', code: 'rate_limited' },
});

const sendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many send requests. Wait a moment.', code: 'rate_limited' },
});

/* ------------------------------------------------------------------ map */

emailMarketingRouter.get('/map', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const settings = await getOrCreateSettings(supabase, orgId, userId);
    const { contacts, unmappedCount } = await loadMapContacts(supabase, orgId);

    const { data: storms, error } = await supabase
      .from('em_storms')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('onset_at', { ascending: false })
      .limit(50);

    if (error) throw new HttpError(500, error.message, 'map_storms_failed');

    res.json({
      contacts,
      unmappedCount,
      storms: (storms ?? []).map((row) => camelize(row)),
      settings,
      emailProvider: currentEmailProvider(),
      weatherProvider: config.emailMarketing.weatherProvider,
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------- settings */

emailMarketingRouter.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const settings = await getOrCreateSettings(supabase, orgId, userId);
    res.json({
      settings,
      emailProvider: currentEmailProvider(),
      weatherProvider: config.emailMarketing.weatherProvider,
    });
  } catch (err) {
    next(err);
  }
});

emailMarketingRouter.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    await getOrCreateSettings(supabase, orgId, userId);
    const parsed = settingsUpdateSchema.parse(req.body);

    const row: Record<string, unknown> = {};
    if (parsed.fromName !== undefined) row.from_name = parsed.fromName;
    if (parsed.replyToEmail !== undefined) row.reply_to_email = parsed.replyToEmail;
    if (parsed.companySignature !== undefined) row.company_signature = parsed.companySignature;
    if (parsed.autoSend !== undefined) row.auto_send = parsed.autoSend;
    if (parsed.followUpDays !== undefined) row.follow_up_days = parsed.followUpDays;
    if (parsed.includeOfferOfHelp !== undefined) {
      row.include_offer_of_help = parsed.includeOfferOfHelp;
    }

    if (Object.keys(row).length === 0) {
      throw new HttpError(400, 'Nothing to update', 'empty_update');
    }

    const { data, error } = await supabase
      .from('em_settings')
      .update(row)
      .eq('org_id', orgId)
      .select('*')
      .maybeSingle();

    if (error) throw new HttpError(400, error.message, 'settings_update_failed');
    if (!data) throw new HttpError(404, 'Settings not found', 'not_found');

    res.json({ settings: camelize(data) });
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------------------- storms */

emailMarketingRouter.post(
  '/storms/scan',
  scanLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const parsed = stormScanSchema.parse(req.body ?? {});
      const { contacts } = await loadMapContacts(supabase, orgId);

      const { alerts, sourceUsed, note } = await fetchWeatherAlerts({
        mode: config.emailMarketing.weatherProvider,
        forceDemo: parsed.demo,
        contactPoints: contacts.map((c) => ({ lat: c.lat, lng: c.lng })),
      });

      const storms = await upsertStorms(supabase, orgId, userId, alerts);

      const matchSummaries = storms.map((storm) => {
        const matches = matchContactsToStorm(contacts, stormToFootprint(storm));
        return {
          stormId: storm.id,
          name: storm.name,
          eventType: storm.eventType,
          severity: storm.severity,
          matchedCount: matches.length,
          emailableCount: matches.filter((m) => !m.skipReason).length,
          skippedCount: matches.filter((m) => m.skipReason).length,
        };
      });

      res.json({
        sourceUsed,
        note,
        storms,
        matches: matchSummaries,
        contactCount: contacts.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

emailMarketingRouter.get('/storms', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { limit, offset, status } = listQuerySchema.parse(req.query);

    let query = supabase
      .from('em_storms')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query
      .order('onset_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, error.message, 'storms_list_failed');

    res.json({
      items: (data ?? []).map((row) => camelize(row)),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

emailMarketingRouter.get(
  '/storms/:id/matches',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const { data: storm, error } = await supabase
        .from('em_storms')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();

      if (error) throw new HttpError(500, error.message, 'storm_read_failed');
      if (!storm) throw new HttpError(404, 'Storm not found', 'not_found');

      const { contacts } = await loadMapContacts(supabase, orgId);
      const matches = matchContactsToStorm(contacts, stormToFootprint(camelize(storm)!));

      res.json({ storm: camelize(storm), matches });
    } catch (err) {
      next(err);
    }
  },
);

/* -------------------------------------------------------------- outreach */

emailMarketingRouter.post('/outreach', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const parsed = createOutreachSchema.parse(req.body);
    const settings = await getOrCreateSettings(supabase, orgId, userId);

    const { data: storm, error: stormErr } = await supabase
      .from('em_storms')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', parsed.stormId)
      .maybeSingle();

    if (stormErr) throw new HttpError(500, stormErr.message, 'storm_read_failed');
    if (!storm) throw new HttpError(404, 'Storm not found', 'not_found');

    const stormCam = camelize(storm)!;
    const defaults = defaultStormTemplates({
      eventType: stormCam.eventType,
      name: stormCam.name,
    });
    const subjectTemplate = parsed.subjectTemplate ?? defaults.subjectTemplate;
    const bodyTemplate = parsed.bodyTemplate ?? defaults.bodyTemplate;

    const { contacts } = await loadMapContacts(supabase, orgId);
    const matches = matchContactsToStorm(contacts, stormToFootprint(stormCam));

    if (matches.length === 0) {
      throw new HttpError(
        400,
        'No mapped contacts fall inside this storm footprint.',
        'no_matches',
      );
    }

    const { data: existing } = await supabase
      .from('em_outreach')
      .select('id, status')
      .eq('org_id', orgId)
      .eq('storm_id', parsed.stormId)
      .maybeSingle();

    if (existing && existing.status === 'sent') {
      throw new HttpError(
        409,
        'Outreach for this storm was already sent. Open it from the outreach list.',
        'already_sent',
      );
    }

    let outreachId = existing?.id as string | undefined;

    if (outreachId) {
      const { error: updErr } = await supabase
        .from('em_outreach')
        .update({
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          matched_count: matches.length,
          status: 'draft',
        })
        .eq('id', outreachId)
        .eq('org_id', orgId);
      if (updErr) throw new HttpError(400, updErr.message, 'outreach_update_failed');

      await supabase.from('em_outreach_messages').delete().eq('outreach_id', outreachId);
    } else {
      const { data: created, error: createErr } = await supabase
        .from('em_outreach')
        .insert({
          org_id: orgId,
          storm_id: parsed.stormId,
          status: 'draft',
          subject_template: subjectTemplate,
          body_template: bodyTemplate,
          matched_count: matches.length,
          created_by: userId,
        })
        .select('id')
        .single();

      if (createErr) throw new HttpError(400, createErr.message, 'outreach_create_failed');
      outreachId = created.id;
    }

    const messageRows = matches.map((match) => {
      const ctx = buildTemplateContext(
        match,
        {
          name: String(stormCam.name),
          eventType: String(stormCam.eventType),
          headline: (stormCam.headline as string | null) ?? null,
          areaDesc: (stormCam.areaDesc as string | null) ?? null,
        },
        settings,
      );
      const rendered = renderStormEmail(subjectTemplate, bodyTemplate, ctx);
      const skipped = Boolean(match.skipReason);

      return {
        org_id: orgId,
        outreach_id: outreachId,
        contact_id: match.contactId,
        property_id: match.propertyId,
        to_email: match.email?.trim() || 'missing@invalid.local',
        to_name: match.name,
        subject: rendered.subject,
        body_text: rendered.bodyText,
        status: skipped ? 'skipped' : 'draft',
        skip_reason: match.skipReason,
        distance_miles: match.distanceMiles,
      };
    });

    const { error: msgErr } = await supabase.from('em_outreach_messages').insert(messageRows);
    if (msgErr) throw new HttpError(400, msgErr.message, 'outreach_messages_failed');

    const detail = await loadOutreachDetail(supabase, orgId, outreachId!);
    res.status(201).json(detail);
  } catch (err) {
    next(err);
  }
});

async function loadOutreachDetail(supabase: any, orgId: string, outreachId: string) {
  const { data: outreach, error } = await supabase
    .from('em_outreach')
    .select('*, em_storms(*)')
    .eq('org_id', orgId)
    .eq('id', outreachId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message, 'outreach_read_failed');
  if (!outreach) throw new HttpError(404, 'Outreach not found', 'not_found');

  const { data: messages, error: msgErr } = await supabase
    .from('em_outreach_messages')
    .select('*')
    .eq('org_id', orgId)
    .eq('outreach_id', outreachId)
    .order('distance_miles', { ascending: true });

  if (msgErr) throw new HttpError(500, msgErr.message, 'outreach_messages_read_failed');

  return {
    outreach: camelize(outreach),
    messages: (messages ?? []).map((row: Record<string, any>) => camelize(row)),
  };
}

emailMarketingRouter.get('/outreach', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { limit, offset, status } = listQuerySchema.parse(req.query);

    let query = supabase
      .from('em_outreach')
      .select('*, em_storms(id, name, event_type, severity, status)', { count: 'exact' })
      .eq('org_id', orgId);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, error.message, 'outreach_list_failed');

    res.json({
      items: (data ?? []).map((row) => camelize(row)),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

emailMarketingRouter.get(
  '/outreach/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const detail = await loadOutreachDetail(supabase, orgId, req.params.id);
      res.json(detail);
    } catch (err) {
      next(err);
    }
  },
);

emailMarketingRouter.patch(
  '/outreach/:id/messages/:messageId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const parsed = messageUpdateSchema.parse(req.body);

      const { data: message, error: readErr } = await supabase
        .from('em_outreach_messages')
        .select('*')
        .eq('org_id', orgId)
        .eq('outreach_id', req.params.id)
        .eq('id', req.params.messageId)
        .maybeSingle();

      if (readErr) throw new HttpError(500, readErr.message, 'message_read_failed');
      if (!message) throw new HttpError(404, 'Message not found', 'not_found');
      if (message.status !== 'draft' && message.status !== 'failed') {
        throw new HttpError(409, 'Only draft or failed messages can be edited.', 'not_editable');
      }

      const row: Record<string, unknown> = {};
      if (parsed.subject !== undefined) row.subject = parsed.subject;
      if (parsed.bodyText !== undefined) row.body_text = parsed.bodyText;

      const { data, error } = await supabase
        .from('em_outreach_messages')
        .update(row)
        .eq('id', message.id)
        .select('*')
        .single();

      if (error) throw new HttpError(400, error.message, 'message_update_failed');
      res.json({ message: camelize(data) });
    } catch (err) {
      next(err);
    }
  },
);

async function sendOneMessage(
  supabase: any,
  args: {
    orgId: string;
    userId: string;
    message: Record<string, any>;
    settings: Awaited<ReturnType<typeof getOrCreateSettings>>;
  },
) {
  if (args.message.status === 'skipped') {
    return { message: args.message, skipped: true };
  }
  if (args.message.status === 'sent') {
    return { message: args.message, skipped: true };
  }

  try {
    const result = await sendMarketingEmail({
      to: args.message.to_email,
      toName: args.message.to_name,
      subject: args.message.subject,
      bodyText: args.message.body_text,
      fromName: args.settings.fromName,
      replyTo: args.settings.replyToEmail,
    });

    const { data, error } = await supabase
      .from('em_outreach_messages')
      .update({
        status: 'sent',
        provider: result.provider,
        provider_message_id: result.messageId,
        sent_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', args.message.id)
      .select('*')
      .single();

    if (error) throw new HttpError(500, error.message, 'message_send_update_failed');

    await recordCrmEmailActivity(supabase, {
      orgId: args.orgId,
      userId: args.userId,
      contactId: args.message.contact_id,
      propertyId: args.message.property_id,
      subject: args.message.subject,
      body: args.message.body_text,
    });

    return { message: data, skipped: false };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Send failed';
    const { data } = await supabase
      .from('em_outreach_messages')
      .update({
        status: 'failed',
        error_message: errorMessage,
      })
      .eq('id', args.message.id)
      .select('*')
      .single();

    return { message: data ?? args.message, skipped: false, error: errorMessage };
  }
}

emailMarketingRouter.post(
  '/outreach/:id/send',
  sendLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const settings = await getOrCreateSettings(supabase, orgId, userId);

      const { data: outreach, error } = await supabase
        .from('em_outreach')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();

      if (error) throw new HttpError(500, error.message, 'outreach_read_failed');
      if (!outreach) throw new HttpError(404, 'Outreach not found', 'not_found');
      if (outreach.status === 'cancelled') {
        throw new HttpError(409, 'This outreach was cancelled.', 'cancelled');
      }

      await supabase
        .from('em_outreach')
        .update({ status: 'sending' })
        .eq('id', outreach.id)
        .eq('org_id', orgId);

      const { data: messages, error: msgErr } = await supabase
        .from('em_outreach_messages')
        .select('*')
        .eq('org_id', orgId)
        .eq('outreach_id', outreach.id)
        .in('status', ['draft', 'failed', 'queued']);

      if (msgErr) throw new HttpError(500, msgErr.message, 'outreach_messages_read_failed');

      let sentCount = 0;
      let failedCount = 0;
      let skippedCount = 0;

      for (const message of messages ?? []) {
        const result = await sendOneMessage(supabase, {
          orgId,
          userId,
          message,
          settings,
        });
        if (result.skipped && message.status === 'skipped') skippedCount += 1;
        else if (result.message?.status === 'sent') sentCount += 1;
        else if (result.message?.status === 'failed') failedCount += 1;
      }

      // Recount skipped from the full set (already-skipped rows were not in the loop).
      const { count: allSkipped } = await supabase
        .from('em_outreach_messages')
        .select('id', { count: 'exact', head: true })
        .eq('outreach_id', outreach.id)
        .eq('status', 'skipped');

      const { count: allSent } = await supabase
        .from('em_outreach_messages')
        .select('id', { count: 'exact', head: true })
        .eq('outreach_id', outreach.id)
        .eq('status', 'sent');

      const { count: allFailed } = await supabase
        .from('em_outreach_messages')
        .select('id', { count: 'exact', head: true })
        .eq('outreach_id', outreach.id)
        .eq('status', 'failed');

      await supabase
        .from('em_outreach')
        .update({
          status: 'sent',
          sent_count: allSent ?? sentCount,
          failed_count: allFailed ?? failedCount,
          skipped_count: allSkipped ?? skippedCount,
          sent_at: new Date().toISOString(),
        })
        .eq('id', outreach.id)
        .eq('org_id', orgId);

      const detail = await loadOutreachDetail(supabase, orgId, outreach.id);
      res.json(detail);
    } catch (err) {
      next(err);
    }
  },
);

emailMarketingRouter.post(
  '/outreach/:id/messages/:messageId/send',
  sendLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const settings = await getOrCreateSettings(supabase, orgId, userId);

      const { data: message, error } = await supabase
        .from('em_outreach_messages')
        .select('*')
        .eq('org_id', orgId)
        .eq('outreach_id', req.params.id)
        .eq('id', req.params.messageId)
        .maybeSingle();

      if (error) throw new HttpError(500, error.message, 'message_read_failed');
      if (!message) throw new HttpError(404, 'Message not found', 'not_found');
      if (message.status === 'skipped') {
        throw new HttpError(409, 'This contact was skipped (opt-out or missing email).', 'skipped');
      }

      const result = await sendOneMessage(supabase, { orgId, userId, message, settings });
      res.json({ message: camelize(result.message) });
    } catch (err) {
      next(err);
    }
  },
);

/* -------------------------------------------------------------- check-ins */

emailMarketingRouter.post(
  '/checkins/schedule',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const parsed = scheduleCheckinsSchema.parse(req.body);
      const settings = await getOrCreateSettings(supabase, orgId, userId);

      const { data: storm, error: stormErr } = await supabase
        .from('em_storms')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', parsed.stormId)
        .maybeSingle();

      if (stormErr) throw new HttpError(500, stormErr.message, 'storm_read_failed');
      if (!storm) throw new HttpError(404, 'Storm not found', 'not_found');

      const stormCam = camelize(storm)!;
      const { contacts } = await loadMapContacts(supabase, orgId);
      let matches = matchContactsToStorm(contacts, stormToFootprint(stormCam));

      // Prefer contacts we already emailed when an outreach id is supplied.
      if (parsed.outreachId) {
        const { data: msgs } = await supabase
          .from('em_outreach_messages')
          .select('contact_id, property_id, to_email, to_name, status')
          .eq('org_id', orgId)
          .eq('outreach_id', parsed.outreachId)
          .eq('status', 'sent');

        const sentIds = new Set((msgs ?? []).map((m) => m.contact_id as string));
        matches = matches.filter((m) => sentIds.has(m.contactId));
      }

      const emailable = matches.filter((m) => !m.skipReason && m.email);
      if (emailable.length === 0) {
        throw new HttpError(
          400,
          'No emailable contacts to schedule check-ins for.',
          'no_checkin_targets',
        );
      }

      const followUpDays = parsed.followUpDays ?? settings.followUpDays;
      const scheduledFor = new Date(Date.now() + followUpDays * 24 * 60 * 60 * 1000).toISOString();
      const templates = defaultCheckinTemplates();

      const rows = emailable.map((match) => {
        const ctx = buildTemplateContext(
          match,
          {
            name: String(stormCam.name),
            eventType: String(stormCam.eventType),
            headline: (stormCam.headline as string | null) ?? null,
            areaDesc: (stormCam.areaDesc as string | null) ?? null,
          },
          settings,
        );
        const rendered = renderStormEmail(
          templates.subjectTemplate,
          templates.bodyTemplate,
          ctx,
        );
        return {
          org_id: orgId,
          storm_id: parsed.stormId,
          outreach_id: parsed.outreachId ?? null,
          contact_id: match.contactId,
          property_id: match.propertyId,
          status: 'scheduled',
          scheduled_for: scheduledFor,
          subject: rendered.subject,
          body_text: rendered.bodyText,
          to_email: match.email,
          created_by: userId,
        };
      });

      const { data, error } = await supabase
        .from('em_checkins')
        .upsert(rows, { onConflict: 'storm_id,contact_id' })
        .select('*');

      if (error) throw new HttpError(400, error.message, 'checkin_schedule_failed');

      res.status(201).json({
        items: (data ?? []).map((row) => camelize(row)),
        scheduledFor,
        count: data?.length ?? 0,
      });
    } catch (err) {
      next(err);
    }
  },
);

emailMarketingRouter.get('/checkins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { limit, offset, status } = listQuerySchema.parse(req.query);

    let query = supabase
      .from('em_checkins')
      .select(
        '*, em_storms(id, name, event_type, severity), crm_contacts(id, first_name, last_name, email)',
        { count: 'exact' },
      )
      .eq('org_id', orgId);

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query
      .order('scheduled_for', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw new HttpError(500, error.message, 'checkins_list_failed');

    res.json({
      items: (data ?? []).map((row) => camelize(row)),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (err) {
    next(err);
  }
});

emailMarketingRouter.post(
  '/checkins/:id/send',
  sendLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, userId, supabase } = await requireOrgContext(req);
      const settings = await getOrCreateSettings(supabase, orgId, userId);

      const { data: checkin, error } = await supabase
        .from('em_checkins')
        .select('*')
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .maybeSingle();

      if (error) throw new HttpError(500, error.message, 'checkin_read_failed');
      if (!checkin) throw new HttpError(404, 'Check-in not found', 'not_found');
      if (checkin.status === 'cancelled') {
        throw new HttpError(409, 'This check-in was cancelled.', 'cancelled');
      }
      if (!checkin.to_email || !checkin.subject || !checkin.body_text) {
        throw new HttpError(400, 'Check-in is missing email content.', 'incomplete');
      }

      const result = await sendMarketingEmail({
        to: checkin.to_email,
        subject: checkin.subject,
        bodyText: checkin.body_text,
        fromName: settings.fromName,
        replyTo: settings.replyToEmail,
      });

      const { data, error: updErr } = await supabase
        .from('em_checkins')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', checkin.id)
        .select('*')
        .single();

      if (updErr) throw new HttpError(500, updErr.message, 'checkin_send_failed');

      await recordCrmEmailActivity(supabase, {
        orgId,
        userId,
        contactId: checkin.contact_id,
        propertyId: checkin.property_id,
        subject: checkin.subject,
        body: checkin.body_text,
      });

      res.json({ checkin: camelize(data), provider: result.provider, messageId: result.messageId });
    } catch (err) {
      next(err);
    }
  },
);

emailMarketingRouter.patch(
  '/checkins/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const parsed = checkinUpdateSchema.parse(req.body);

      const row: Record<string, unknown> = {};
      if (parsed.status !== undefined) row.status = parsed.status;
      if (parsed.outcomeNotes !== undefined) row.outcome_notes = parsed.outcomeNotes;
      if (parsed.subject !== undefined) row.subject = parsed.subject;
      if (parsed.bodyText !== undefined) row.body_text = parsed.bodyText;
      if (parsed.status === 'completed') row.completed_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('em_checkins')
        .update(row)
        .eq('org_id', orgId)
        .eq('id', req.params.id)
        .select('*')
        .maybeSingle();

      if (error) throw new HttpError(400, error.message, 'checkin_update_failed');
      if (!data) throw new HttpError(404, 'Check-in not found', 'not_found');

      res.json({ checkin: camelize(data) });
    } catch (err) {
      next(err);
    }
  },
);
