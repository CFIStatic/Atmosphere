import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { HttpError } from '../lib/errors.js';
import {
  summariseJobs,
  phraseEvent,
  isCustomerRelevant,
  statusLabel,
  type RawEvent,
  type JobRow,
} from '../sales/workFeed.js';
import {
  deliveryEvents,
  dryingByArea,
  deliverySentence,
  phaseLabel,
  phaseProgress,
  draftCustomerUpdate,
} from '../sales/delivery.js';
import {
  buildMailSender,
  finaliseBody,
  screenRecipients,
  subjectProblems,
  validatePolicy,
} from '../campaigns/mail/index.js';
import { loadGateLists } from '../campaigns/mail/gate.js';
import rateLimit from 'express-rate-limit';

/**
 * What the company is doing on the work this salesperson sold.
 *
 * Everything here is already recorded — crews log hours, tasks close, jobs
 * change status, and a trigger writes each one into `memory_events`. None of it
 * has ever been shown to the person who sold the job, so they find out how
 * delivery is going by phoning the office, and the customer usually gets there
 * first.
 *
 * Read-only by design. A salesperson watching delivery is exactly the wrong
 * person to be able to change a schedule from a summary screen, and a page that
 * offered it would produce edits made without the context the office has.
 */
export const salesWorkRouter = Router();

salesWorkRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

const EVENT_SELECT =
  'id, seq, actor_id, actor_email, event_type, entity_type, entity_id, job_id, summary, changes, occurred_at';

const JOB_SELECT =
  'id, job_number, title, status, work_type, owner_id, scheduled_start, scheduled_end, ' +
  'actual_start, actual_end, contract_amount, invoiced_amount, paid_amount, account_id, ' +
  'contact_id, updated_at';

/** Account and contact names for the jobs in hand, so the feed says who. */
async function namesFor(supabase: any, jobs: JobRow[]) {
  const accountIds = [...new Set(jobs.map((j) => j.account_id).filter(Boolean))] as string[];
  const contactIds = [...new Set(jobs.map((j) => j.contact_id).filter(Boolean))] as string[];

  const [accounts, contacts] = await Promise.all([
    accountIds.length
      ? supabase.from('crm_accounts').select('id, name').in('id', accountIds)
      : Promise.resolve({ data: [] }),
    contactIds.length
      ? supabase.from('crm_contacts').select('id, first_name, last_name').in('id', contactIds)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    accounts: new Map<string, string>(
      ((accounts.data ?? []) as any[]).map((a) => [a.id, a.name]),
    ),
    contacts: new Map<string, string>(
      ((contacts.data ?? []) as any[]).map((c) => [
        c.id,
        [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Contact',
      ]),
    ),
  };
}

/**
 * GET /api/sales/work?scope=mine|all
 *
 * The jobs, what state each is in, and the last thing that happened on it —
 * plus one merged feed across all of them, which is the "what's the latest"
 * answer somebody opens this page for.
 *
 * Defaults to the jobs this person owns. A territory salesperson often does not
 * own the job record even though it is their customer, so `scope=all` is there
 * — but defaulting to it would open the page on two hundred jobs belonging to
 * everyone, which answers nobody's question.
 */
salesWorkRouter.get('/work', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const query = z
      .object({
        scope: z.enum(['mine', 'all']).default('mine'),
        limit: z.coerce.number().int().min(1).max(100).default(40),
      })
      .parse(req.query ?? {});

    let jobQuery = supabase
      .from('crm_jobs')
      .select(JOB_SELECT)
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(query.limit);
    if (query.scope === 'mine') jobQuery = jobQuery.eq('owner_id', userId);

    const { data: jobData, error } = await jobQuery;
    if (error) throw new HttpError(500, error.message, 'sales_work_failed');
    const jobs = (jobData ?? []) as unknown as JobRow[];

    if (!jobs.length) {
      res.json({ scope: query.scope, jobs: [], latest: [], counts: emptyCounts() });
      return;
    }

    const jobIds = jobs.map((j) => j.id);
    const [{ data: eventData }, names, { data: deliveryData }] = await Promise.all([
      supabase
        .from('memory_events')
        .select(EVENT_SELECT)
        .eq('org_id', orgId)
        .in('job_id', jobIds)
        .order('seq', { ascending: false })
        .limit(300),
      namesFor(supabase, jobs),
      // The Operations side of the same jobs. A view rather than a join here,
      // because the pairing is partly inferred from claim numbers and that rule
      // belongs in one place.
      supabase
        .from('crm_job_delivery')
        .select('job_id, project_id, project_number, phase, project_status, matched_by, target_completion_at, customer_email')
        .eq('org_id', orgId)
        .in('job_id', jobIds),
    ]);

    const delivery = new Map<string, any>(
      ((deliveryData ?? []) as any[]).map((row) => [row.job_id, row]),
    );

    const events = (eventData ?? []) as unknown as RawEvent[];
    const summaries = summariseJobs({
      jobs,
      events,
      accounts: names.accounts,
      contacts: names.contacts,
    });
    // The phase is the honest headline for a job in production: crm_jobs
    // status says "in progress" for six weeks, where the phase says drying,
    // then rebuild, then punch list.
    const withDelivery = summaries.map((job) => {
      const row = delivery.get(job.id);
      return {
        ...job,
        projectId: row?.project_id ?? null,
        projectNumber: row?.project_number ?? null,
        phase: row?.phase ?? null,
        phaseLabel: row ? phaseLabel(row.phase) : null,
        phaseProgress: row ? phaseProgress(row.phase) : null,
        // Says whether Operations was found by an explicit link or by a shared
        // claim number, because those are different levels of confidence.
        deliveryMatchedBy: row?.matched_by ?? null,
        customerEmail: row?.customer_email ?? null,
      };
    });
    const byId = new Map(withDelivery.map((s) => [s.id, s]));

    // One merged stream across every job, which is the thing the page is for:
    // "what has happened since I last looked", not "what happened on job 412".
    const latest = events
      .filter(isCustomerRelevant)
      .slice(0, 40)
      .map((event) => {
        const said = phraseEvent(event);
        const job = event.job_id ? byId.get(event.job_id) : null;
        return {
          id: event.id,
          seq: event.seq,
          jobId: event.job_id,
          jobNumber: job?.jobNumber ?? null,
          jobTitle: job?.title ?? null,
          customer: job?.customer ?? null,
          text: said.text,
          tone: said.tone,
          // The actor is who did it, and on this page that is usually a crew
          // member the salesperson has never met. Kept because "who do I ask"
          // is the immediate follow-up question.
          by: event.actor_email,
          at: event.occurred_at,
        };
      });

    res.json({
      scope: query.scope,
      jobs: withDelivery,
      // How much of the picture is actually joined up. A salesperson looking at
      // a job with no project behind it should know that is why the page is
      // thin, rather than concluding nothing is happening.
      deliveryLinked: withDelivery.filter((j) => j.projectId).length,
      latest,
      counts: {
        open: withDelivery.filter((j) => j.open).length,
        onSite: withDelivery.filter((j) => j.status === 'in_progress').length,
        quiet: withDelivery.filter((j) => j.quiet).length,
        awaitingPayment: withDelivery.filter((j) => j.status === 'invoiced').length,
      },
    });
  } catch (err) {
    next(err);
  }
});

function emptyCounts() {
  return { open: 0, onSite: 0, quiet: 0, awaitingPayment: 0 };
}

/**
 * GET /api/sales/work/:jobId
 * One job in full: where it stands, who is on it, and its own timeline.
 */
salesWorkRouter.get('/work/:jobId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);

    const { data, error } = await supabase
      .from('crm_jobs')
      .select(JOB_SELECT)
      .eq('org_id', orgId)
      .eq('id', req.params.jobId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message, 'sales_work_failed');
    if (!data) throw new HttpError(404, 'No such job.', 'job_not_found');
    const job = data as unknown as JobRow;

    const [{ data: eventData }, { data: crewData }, names] = await Promise.all([
      supabase
        .from('memory_events')
        .select(EVENT_SELECT)
        .eq('org_id', orgId)
        .eq('job_id', job.id)
        .order('seq', { ascending: false })
        .limit(80),
      // Released rows are kept deliberately, so this filters to who is on it
      // now rather than everyone who ever was.
      supabase
        .from('job_assignments')
        .select('user_id, role_on_job, assigned_at, profiles(full_name, email)')
        .eq('job_id', job.id)
        .is('released_at', null),
      namesFor(supabase, [job]),
    ]);

    const events = ((eventData ?? []) as unknown as RawEvent[]).filter(isCustomerRelevant);
    const summary = summariseJobs({
      jobs: [job],
      events,
      accounts: names.accounts,
      contacts: names.contacts,
    })[0];

    // The Operations and Field half. Fetched second because everything it needs
    // hangs off a project id we do not have until the view has been read, and a
    // job with no project behind it should cost one query rather than seven.
    const { data: pairing } = await supabase
      .from('crm_job_delivery')
      .select('project_id, project_number, phase, project_status, matched_by, target_completion_at, customer_email, customer_phone, adjuster_email, started_at, completed_at')
      .eq('org_id', orgId)
      .eq('job_id', job.id)
      .maybeSingle();

    let delivery: any = null;
    if (pairing?.project_id) {
      const projectId = pairing.project_id;
      const [areas, readings, placements, milestones, alerts, updates] = await Promise.all([
        supabase.from('pm_drying_areas').select('id, label, dry_goal_pct').eq('project_id', projectId),
        supabase
          .from('pm_moisture_readings')
          .select('id, area_id, moisture_pct, taken_at')
          .eq('project_id', projectId)
          .order('taken_at', { ascending: false })
          .limit(400),
        supabase
          .from('pm_equipment_placements')
          .select('id, area_label, placed_at, removed_at')
          .eq('project_id', projectId)
          .order('placed_at', { ascending: false })
          .limit(50),
        supabase
          .from('pm_milestones')
          .select('id, label, kind, completed_at, due_at')
          .eq('project_id', projectId)
          .order('due_at', { ascending: false })
          .limit(50),
        supabase
          .from('pm_alerts')
          .select('id, title, severity, category, status, created_at')
          .eq('project_id', projectId)
          .eq('status', 'open')
          .limit(20),
        supabase
          .from('pm_updates')
          .select('id, audience, subject, status, sent_at, created_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const drying = dryingByArea((areas.data ?? []) as any[], (readings.data ?? []) as any[]);
      delivery = {
        projectId,
        projectNumber: pairing.project_number,
        phase: pairing.phase,
        phaseLabel: phaseLabel(pairing.phase),
        phaseProgress: phaseProgress(pairing.phase),
        matchedBy: pairing.matched_by,
        targetCompletion: pairing.target_completion_at,
        customerEmail: pairing.customer_email,
        adjusterEmail: pairing.adjuster_email,
        drying,
        headline: deliverySentence({
          phase: pairing.phase,
          areas: drying,
          targetCompletion: pairing.target_completion_at,
        }),
        events: deliveryEvents({
          milestones: (milestones.data ?? []) as any[],
          placements: (placements.data ?? []) as any[],
          readings: (readings.data ?? []) as any[],
          areas: (areas.data ?? []) as any[],
          alerts: (alerts.data ?? []) as any[],
          updates: (updates.data ?? []) as any[],
        }),
      };
    }

    // Messages this platform has already sent about this job, so nobody sends
    // the same update twice from two different screens.
    const { data: sendData } = await supabase
      .from('crm_sends')
      .select('id, email, subject, state, blocked_reason, sent_at, created_at')
      .eq('org_id', orgId)
      .eq('job_id', job.id)
      .order('created_at', { ascending: false })
      .limit(20);

    // One timeline, both halves, newest first. Keeping Sales' events and
    // Operations' in separate lists would leave somebody reading two columns to
    // work out the order things happened in.
    const merged = [
      ...events.map((event) => {
        const said = phraseEvent(event);
        return {
          id: event.id,
          text: said.text,
          tone: said.tone,
          source: 'sales' as const,
          by: event.actor_email as string | null,
          at: event.occurred_at,
        };
      }),
      ...((delivery?.events ?? []) as any[]).map((e) => ({
        id: e.id,
        text: e.text,
        tone: e.tone,
        source: e.source,
        by: null,
        at: e.at,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    // The draft is composed here rather than in the browser so the wording is
    // one implementation, testable, and the same whoever opens the job.
    const suggestedUpdate = draftCustomerUpdate({
      customerName: summary.customer,
      jobTitle: summary.title,
      phase: delivery?.phase ?? null,
      areas: delivery?.drying ?? [],
      recentEvents: delivery?.events ?? [],
    });

    res.json({
      delivery,
      suggestedUpdate,
      // Where to send it. The project's customer email is the one Operations
      // has been using; the CRM contact is the one Sales knows. Offering both
      // and choosing neither is the honest position when they disagree.
      recipients: [
        delivery?.customerEmail ? { label: 'Customer (from Operations)', email: delivery.customerEmail } : null,
        delivery?.adjusterEmail ? { label: 'Adjuster', email: delivery.adjusterEmail } : null,
      ].filter(Boolean),
      sends: ((sendData ?? []) as any[]).map((row) => ({
        id: row.id,
        email: row.email,
        subject: row.subject,
        state: row.state,
        blockedReason: row.blocked_reason,
        at: row.sent_at ?? row.created_at,
      })),
      job: {
        ...summary,
        workType: job.work_type,
        scheduledEnd: job.scheduled_end,
        actualStart: job.actual_start,
        actualEnd: job.actual_end,
        paidAmount: job.paid_amount,
      },
      crew: ((crewData ?? []) as any[]).map((row) => ({
        userId: row.user_id,
        name: row.profiles?.full_name ?? row.profiles?.email ?? 'Crew member',
        role: row.role_on_job,
        since: row.assigned_at,
      })),
      timeline: merged.slice(0, 60),
    });
  } catch (err) {
    next(err);
  }
});


/**
 * Sending is the most consequential thing here by a wide margin, and these go
 * to real customers mid-job. A tighter budget than the campaign sender, because
 * one update per job per event is the intended volume and anything approaching
 * this ceiling is a loop.
 */
const updateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many updates sent this hour.', code: 'rate_limited' },
});

const updateSchema = z.object({
  to: z.string().email().max(200),
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(10).max(5000),
  /** Nothing leaves without this, so a preview cannot become a send by accident. */
  confirm: z.boolean().optional(),
});

/**
 * POST /api/sales/work/:jobId/update
 *
 * Send the customer a note about their job — or, without `confirm`, see exactly
 * what would happen if you did.
 *
 * Goes through the same gate as every campaign message: erasure, suppression,
 * unsubscribe, hard bounces, daily ceiling, postal address, working opt-out.
 * A job update is a message to somebody who is already a customer, which makes
 * it a great deal more welcome than cold outreach and not one bit exempt from
 * the list somebody put themselves on.
 *
 * Deliberately one recipient at a time. A bulk "update everyone" button on a
 * page a salesperson opens between calls is a way to mail four hundred
 * customers about work on somebody else's house.
 */
salesWorkRouter.post(
  '/work/:jobId/update',
  updateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const input = updateSchema.parse(req.body ?? {});
      const confirm = input.confirm === true;

      const { data: jobRow } = await supabase
        .from('crm_jobs')
        .select('id, title, job_number')
        .eq('org_id', orgId)
        .eq('id', req.params.jobId)
        .maybeSingle();
      if (!jobRow) throw new HttpError(404, 'No such job.', 'job_not_found');

      const { data: policyRow } = await supabase
        .from('crm_send_policy')
        .select('*')
        .eq('org_id', orgId)
        .maybeSingle();

      const policy = {
        postalAddress: (policyRow as any)?.postal_address ?? '',
        unsubscribeUrl: (policyRow as any)?.unsubscribe_url ?? '',
        maxRecipients: 1,
        dailyCeiling: (policyRow as any)?.daily_ceiling ?? 200,
      };

      const problems = [...validatePolicy(policy), ...subjectProblems(input.subject)];
      // A missing postal address or opt-out link is not a warning here — those
      // are the two things the law names, and shipping a message without them
      // is the violation rather than a step towards one.
      if (confirm && validatePolicy(policy).length) {
        throw new HttpError(
          400,
          'Set your postal address and unsubscribe link in Settings before sending.',
          'policy_incomplete',
        );
      }

      const sender = confirm ? await buildMailSender(orgId) : null;
      if (confirm && !sender) {
        throw new HttpError(400, 'Connect a mailbox before sending.', 'no_mailbox');
      }

      const lists = await loadGateLists(supabase, orgId, { jobId: jobRow.id });
      const screened = screenRecipients({
        recipients: [{ email: input.to }],
        ...lists,
        policy: {
          ...policy,
          dailyCeiling: Math.min(policy.dailyCeiling, sender?.dailyCeiling ?? policy.dailyCeiling),
        },
      });

      if (!confirm) {
        res.json({
          dryRun: true,
          wouldSend: screened.send.length,
          blocked: screened.blocked,
          warnings: problems,
        });
        return;
      }

      if (!screened.send.length) {
        // The reason matters more than the refusal. "Unsubscribed" means pick
        // up the phone; "over daily cap" means try tomorrow.
        res.json({ sent: 0, blocked: screened.blocked });
        return;
      }

      // The row first, so the record of the attempt exists whatever happens to
      // the send — a message that went out with no row is the one nobody can
      // account for later.
      const { data: row, error: rowError } = await supabase
        .from('crm_sends')
        .insert({
          org_id: orgId,
          kind: 'job_update',
          job_id: jobRow.id,
          email: input.to,
          subject: input.subject,
          state: 'queued',
        })
        .select('id, unsubscribe_token')
        .single();
      if (rowError || !row) throw new HttpError(500, 'Could not record the send.', 'send_failed');

      const identity = await sender!.identity();
      const body = finaliseBody(input.body, policy, row.unsubscribe_token);
      const unsubscribeUrl = `${policy.unsubscribeUrl}${policy.unsubscribeUrl.includes('?') ? '&' : '?'}t=${encodeURIComponent(row.unsubscribe_token)}`;

      const result = await sender!.send({
        to: input.to,
        toName: null,
        subject: input.subject,
        text: body,
        replyTo: (policyRow as any)?.reply_to ?? null,
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

      res.json({
        sent: result.ok ? 1 : 0,
        blocked: screened.blocked,
        from: identity.address,
        error: result.error ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/sales/communications
 * Everybody this platform has written to, and how it went.
 *
 * One list across campaigns and job updates, because "who are we reaching out
 * to?" has one answer. Reading the opt-out state here means the page can say
 * "unsubscribed — call instead" rather than offering a button that will be
 * refused.
 */
salesWorkRouter.get('/communications', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit ?? 50);

    const { data, error } = await supabase
      .from('crm_outreach_people')
      .select('*')
      .eq('org_id', orgId)
      .order('last_at', { ascending: false })
      .limit(limit);
    if (error) throw new HttpError(500, error.message, 'communications_failed');

    const rows = (data ?? []) as any[];
    res.json({
      people: rows.map((row) => ({
        email: row.email,
        messages: Number(row.messages ?? 0),
        delivered: Number(row.delivered ?? 0),
        bounced: Number(row.bounced ?? 0),
        blocked: Number(row.blocked ?? 0),
        campaignMessages: Number(row.campaign_messages ?? 0),
        updateMessages: Number(row.update_messages ?? 0),
        lastAt: row.last_at,
        unsubscribed: Boolean(row.unsubscribed),
        suppressed: Boolean(row.suppressed),
      })),
      totals: {
        people: rows.length,
        messages: rows.reduce((n, r) => n + Number(r.messages ?? 0), 0),
        bounced: rows.reduce((n, r) => n + Number(r.bounced ?? 0), 0),
        optedOut: rows.filter((r) => r.unsubscribed || r.suppressed).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sales/communications/:email
 * Every message to one person, newest first — what was sent, what was blocked
 * and why, and which job or campaign it belonged to.
 */
salesWorkRouter.get(
  '/communications/:email',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId, supabase } = await requireOrgContext(req);
      const email = z.string().email().max(200).parse(decodeURIComponent(req.params.email));

      const { data, error } = await supabase
        .from('crm_sends')
        .select('id, kind, subject, state, blocked_reason, error, sent_at, created_at, campaign_id, job_id')
        .eq('org_id', orgId)
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new HttpError(500, error.message, 'communications_failed');

      const rows = (data ?? []) as any[];
      const campaignIds = [...new Set(rows.map((r) => r.campaign_id).filter(Boolean))];
      const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))];

      const [campaigns, jobs] = await Promise.all([
        campaignIds.length
          ? supabase.from('crm_campaigns').select('id, name').in('id', campaignIds)
          : Promise.resolve({ data: [] }),
        jobIds.length
          ? supabase.from('crm_jobs').select('id, title, job_number').in('id', jobIds)
          : Promise.resolve({ data: [] }),
      ]);

      const campaignName = new Map(((campaigns.data ?? []) as any[]).map((c) => [c.id, c.name]));
      const jobName = new Map(
        ((jobs.data ?? []) as any[]).map((j) => [j.id, `#${j.job_number} · ${j.title}`]),
      );

      res.json({
        email,
        messages: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          subject: row.subject,
          state: row.state,
          blockedReason: row.blocked_reason,
          error: row.error,
          about: row.campaign_id
            ? (campaignName.get(row.campaign_id) ?? 'Campaign')
            : row.job_id
              ? (jobName.get(row.job_id) ?? 'A job')
              : null,
          at: row.sent_at ?? row.created_at,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

export { statusLabel };
