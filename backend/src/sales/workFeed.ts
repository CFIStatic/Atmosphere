/**
 * What the company is doing on the work you sold.
 *
 * A salesperson finds out how a job is going by phoning the office, and the
 * customer usually gets there first. Everything needed to answer them is
 * already in the database — crews log their hours, tasks close, jobs change
 * status, and a trigger records every one of it in `memory_events`. It has just
 * never been pointed at the person who sold the job.
 *
 * This file is the translation layer, and it is deliberately pure so the
 * wording can be tested without a database. Two jobs:
 *
 *   1. Turn an internal event into a sentence a salesperson can repeat to a
 *      customer. "status: in_progress → complete" is a database row. "Work
 *      finished on site" is something you can say on the phone.
 *
 *   2. Work out what is worth flagging. The useful signal is not the job that
 *      is progressing — it is the one that has gone quiet, because that is the
 *      one the customer is about to call about.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A memory row, in the shape the query returns it. */
export interface RawEvent {
  id: string;
  seq: number;
  event_type: string;
  entity_type: string;
  job_id: string | null;
  actor_email: string | null;
  summary: string;
  changes: Record<string, { from?: unknown; to?: unknown }> | null;
  occurred_at: string;
}

export interface JobRow {
  id: string;
  job_number: number | null;
  title: string;
  status: string;
  work_type: string | null;
  owner_id: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  contract_amount: number | null;
  invoiced_amount: number | null;
  paid_amount: number | null;
  account_id: string | null;
  contact_id: string | null;
  updated_at: string;
}

/** How a job's status reads to somebody outside the delivery team. */
const STATUS_WORDS: Record<string, string> = {
  draft: 'Not started',
  scheduled: 'Scheduled',
  in_progress: 'On site',
  on_hold: 'On hold',
  complete: 'Work complete',
  invoiced: 'Invoiced',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

/** Which statuses mean the job is live and somebody should be hearing about it. */
const OPEN_STATUSES = new Set(['draft', 'scheduled', 'in_progress', 'on_hold']);

export function statusLabel(status: string): string {
  return STATUS_WORDS[status] ?? status.replace(/_/g, ' ');
}

/** True while the job is still being delivered rather than closed out. */
export function isOpen(status: string): boolean {
  return OPEN_STATUSES.has(status);
}

/**
 * A plain-language line for one event.
 *
 * The stored `summary` is written for the audit trail — accurate, internal, and
 * full of field names. This rewrites the handful of event types a salesperson
 * actually cares about and falls back to the stored sentence for the rest,
 * which is the right failure: an unfamiliar event still shows up, just in the
 * original wording, rather than disappearing from the feed.
 */
export function phraseEvent(event: RawEvent): { text: string; tone: 'progress' | 'money' | 'crew' | 'attention' | 'other' } {
  const changes = event.changes ?? {};
  const to = (field: string) => String(changes[field]?.to ?? '');

  switch (event.event_type) {
    case 'job.created':
      return { text: 'Job opened', tone: 'other' };

    case 'job.status_changed': {
      const next = to('status');
      if (next === 'in_progress') return { text: 'Crew started on site', tone: 'progress' };
      if (next === 'complete') return { text: 'Work finished on site', tone: 'progress' };
      if (next === 'on_hold') return { text: 'Put on hold', tone: 'attention' };
      if (next === 'invoiced') return { text: 'Invoice sent', tone: 'money' };
      if (next === 'paid') return { text: 'Paid in full', tone: 'money' };
      if (next === 'cancelled') return { text: 'Cancelled', tone: 'attention' };
      if (next === 'scheduled') return { text: 'Scheduled', tone: 'progress' };
      return { text: `Moved to ${statusLabel(next).toLowerCase()}`, tone: 'progress' };
    }

    case 'job.updated': {
      // Only the fields somebody would be asked about. A change to an internal
      // note is not news, and a feed that reported every one would bury the
      // changes that are.
      if (changes.scheduled_start) return { text: 'Schedule changed', tone: 'attention' };
      if (changes.contract_amount) return { text: 'Contract amount changed', tone: 'money' };
      if (changes.actual_end) return { text: 'Work finished on site', tone: 'progress' };
      if (changes.actual_start) return { text: 'Crew arrived on site', tone: 'progress' };
      return { text: event.summary, tone: 'other' };
    }

    case 'work_log.created': {
      const minutes = Number(changes.minutes?.to ?? 0);
      const hours = minutes >= 60 ? `${Math.round((minutes / 60) * 10) / 10}h logged — ` : '';
      const body = String(changes.body?.to ?? '').trim();
      // The crew's own words, which are the most useful thing on this page and
      // the only line here anybody would quote back to a customer verbatim.
      return {
        text: body ? `${hours}${body}` : `${hours}Work logged`.trim(),
        tone: 'progress',
      };
    }

    case 'task.status_changed': {
      const next = to('status');
      const title = String(changes.title?.to ?? '').trim();
      if (next === 'done') return { text: title ? `Finished: ${title}` : 'Task finished', tone: 'progress' };
      if (next === 'blocked') return { text: title ? `Blocked: ${title}` : 'Task blocked', tone: 'attention' };
      if (next === 'in_progress') return { text: title ? `Started: ${title}` : 'Task started', tone: 'progress' };
      return { text: event.summary, tone: 'other' };
    }

    case 'assignment.created':
      return { text: 'Crew assigned', tone: 'crew' };
    case 'assignment.updated':
      return { text: 'Crew changed', tone: 'crew' };

    default:
      return { text: event.summary, tone: 'other' };
  }
}

/**
 * Events a salesperson should never see, whatever else happens.
 *
 * Sign-ins and internal task churn are the org's business, not the customer
 * relationship's. Filtering here rather than in the query keeps the rule in one
 * readable place and testable without a database.
 */
export function isCustomerRelevant(event: RawEvent): boolean {
  if (event.entity_type === 'session') return false;
  if (event.event_type.startsWith('auth.')) return false;
  // A job row touched with no meaningful field change is noise the trigger
  // records for completeness; it is not news.
  if (event.event_type === 'job.updated') {
    const changes = event.changes ?? {};
    const meaningful = ['scheduled_start', 'scheduled_end', 'actual_start', 'actual_end', 'contract_amount', 'status'];
    return meaningful.some((field) => field in changes);
  }
  return true;
}

/** Whole days since a timestamp. Null for anything unparseable. */
export function daysSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.floor((now.getTime() - at) / 86_400_000);
}

/**
 * How long a job may go without news before it is worth flagging.
 *
 * Different by status because the expectations are different: a job with a
 * crew on it should produce something most days, and one merely scheduled can
 * sit quietly until its start date without anything being wrong.
 */
const QUIET_AFTER_DAYS: Record<string, number> = {
  in_progress: 3,
  on_hold: 7,
  scheduled: 14,
  draft: 14,
};

/**
 * The jobs, summarised — with the last thing that happened on each.
 *
 * "Gone quiet" is the point of this function. A job that is progressing needs
 * no attention; one that has not been touched in a week, with a customer who
 * was promised a crew, is the call the salesperson wants to make first rather
 * than receive.
 */
export function summariseJobs(input: {
  jobs: JobRow[];
  events: RawEvent[];
  accounts: Map<string, string>;
  contacts: Map<string, string>;
  now?: Date;
}): Array<{
  id: string;
  jobNumber: number | null;
  title: string;
  customer: string | null;
  status: string;
  statusLabel: string;
  open: boolean;
  scheduledStart: string | null;
  contractAmount: number | null;
  invoicedAmount: number | null;
  lastEventAt: string | null;
  lastEventText: string | null;
  daysQuiet: number | null;
  /** True when an open job has gone longer than its status allows without news. */
  quiet: boolean;
}> {
  const now = input.now ?? new Date();

  // Newest event per job. The events arrive newest-first, so the first one seen
  // for a job is the one to keep.
  const latest = new Map<string, RawEvent>();
  for (const event of input.events) {
    if (!event.job_id) continue;
    if (!isCustomerRelevant(event)) continue;
    if (!latest.has(event.job_id)) latest.set(event.job_id, event);
  }

  return input.jobs.map((job) => {
    const last = latest.get(job.id) ?? null;
    // Falls back to the row's own updated_at, so a job with no events yet still
    // reports an age rather than looking brand new forever.
    const lastAt = last?.occurred_at ?? job.updated_at ?? null;
    const quietDays = daysSince(lastAt, now);
    const threshold = QUIET_AFTER_DAYS[job.status];
    const open = isOpen(job.status);

    return {
      id: job.id,
      jobNumber: job.job_number,
      title: job.title,
      customer:
        (job.account_id ? input.accounts.get(job.account_id) : null) ??
        (job.contact_id ? input.contacts.get(job.contact_id) : null) ??
        null,
      status: job.status,
      statusLabel: statusLabel(job.status),
      open,
      scheduledStart: job.scheduled_start,
      contractAmount: job.contract_amount,
      invoicedAmount: job.invoiced_amount,
      lastEventAt: lastAt,
      lastEventText: last ? phraseEvent(last).text : null,
      daysQuiet: quietDays,
      quiet:
        open && threshold !== undefined && quietDays !== null && quietDays >= threshold,
    };
  });
}
