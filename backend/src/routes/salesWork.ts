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
    const [{ data: eventData }, names] = await Promise.all([
      supabase
        .from('memory_events')
        .select(EVENT_SELECT)
        .eq('org_id', orgId)
        .in('job_id', jobIds)
        .order('seq', { ascending: false })
        .limit(300),
      namesFor(supabase, jobs),
    ]);

    const events = (eventData ?? []) as unknown as RawEvent[];
    const summaries = summariseJobs({
      jobs,
      events,
      accounts: names.accounts,
      contacts: names.contacts,
    });
    const byId = new Map(summaries.map((s) => [s.id, s]));

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
      jobs: summaries,
      latest,
      counts: {
        open: summaries.filter((j) => j.open).length,
        onSite: summaries.filter((j) => j.status === 'in_progress').length,
        quiet: summaries.filter((j) => j.quiet).length,
        awaitingPayment: summaries.filter((j) => j.status === 'invoiced').length,
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

    res.json({
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
      timeline: events.map((event) => {
        const said = phraseEvent(event);
        return {
          id: event.id,
          seq: event.seq,
          text: said.text,
          tone: said.tone,
          by: event.actor_email,
          at: event.occurred_at,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

export { statusLabel };
