import { Router, type Request, type Response, type NextFunction } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { requireAuth } from '../middleware/requireAuth.js';
import {
  createJobSchema,
  updateJobSchema,
  createTaskSchema,
  updateTaskSchema,
  createWorkLogSchema,
  updateWorkLogSchema,
  assignAgentSchema,
} from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';
import {
  serializeJob,
  serializeTask,
  serializeAssignment,
  serializeWorkLog,
  serializeMemoryEvent,
  serializeJobMemory,
  loadPeople,
  toColumns,
  JOB_COLUMNS,
  TASK_COLUMNS,
  WORK_LOG_COLUMNS,
} from '../lib/memory.js';

/**
 * Jobs, tasks, crew and work logs.
 *
 * Note what is absent: not one route writes an audit record. Every mutation
 * below is captured by a database trigger, which is what makes the memory
 * complete rather than as complete as this file remembers to be. It also means
 * a route added later is recorded automatically, with no chance of somebody
 * forgetting the logging call.
 *
 * There are no DELETE routes either, and that is not an omission — the database
 * grants no DELETE privilege on any of these tables. Jobs are cancelled, tasks
 * are cancelled, crew are released. Nothing that has happened stops having
 * happened.
 */
export const jobsRouter = Router();

jobsRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

const JOB_SELECT = '*';
const TASK_SELECT = '*';
const ASSIGNMENT_SELECT = '*';
const WORK_LOG_SELECT = '*';

/**
 * Postgres speaks in constraint names; the user should not have to. RLS refusals
 * in particular arrive as a generic policy violation, and the honest reading is
 * almost always "that job is not yours", so say that.
 */
function dbError(error: { message: string; code?: string }, fallback: string): HttpError {
  const msg = error.message ?? '';
  if (error.code === '42501' || /row-level security/i.test(msg)) {
    return new HttpError(403, 'You do not have access to that.', 'forbidden');
  }
  if (error.code === '23505' || /duplicate key/i.test(msg)) {
    return new HttpError(409, 'That already exists.', 'conflict');
  }
  if (error.code === '23514' || /violates check constraint/i.test(msg)) {
    return new HttpError(400, 'That value is not allowed.', 'invalid_value');
  }
  if (error.code === '23503' || /foreign key/i.test(msg)) {
    return new HttpError(400, 'That refers to something that does not exist.', 'bad_reference');
  }
  return new HttpError(400, msg || fallback, 'db_error');
}

/** Reads a job by id, 404-ing rather than returning null so callers stay simple. */
async function loadJob(supabase: any, jobId: string) {
  const { data, error } = await supabase.from('crm_jobs').select(JOB_SELECT).eq('id', jobId).maybeSingle();
  if (error) throw dbError(error, 'Could not load that job.');
  if (!data) throw new HttpError(404, 'Job not found.', 'job_not_found');
  return data;
}

/* ==========================================================================
 * Jobs
 * ========================================================================== */

/**
 * GET /api/jobs
 * The job list, rolled up with its memory (task counts, crew, last event).
 * `?status=` and `?mine=1` narrow it; `?q=` searches title and claim number.
 */
jobsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    let query = supabase.from('job_memory').select('*');

    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && status !== 'all') {
      if (status === 'open') {
        query = query.not('status', 'in', '("completed","invoiced","paid","cancelled")');
      } else {
        query = query.eq('status', status);
      }
    }
    if (req.query.mine === '1') query = query.eq('owner_id', req.user!.id);

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      // Commas and parens are PostgREST's own filter syntax, so they are
      // stripped rather than escaped — a search box should not be able to
      // rewrite the query it is filtering.
      const safe = q.replace(/[%,()]/g, ' ');
      query = query.or(
        `title.ilike.%${safe}%,claim_number.ilike.%${safe}%`,
      );
    }

    const { data, error } = await query.order('updated_at', { ascending: false }).limit(200);
    if (error) throw dbError(error, 'Could not load jobs.');

    // The job_memory view carries the rollups but not the money or the
    // schedule; the Overview's revenue and receivables tiles need both, so
    // they are merged in from crm_jobs rather than widening the view.
    const rows = data ?? [];
    const financials = new Map<string, any>();
    const crewByJob = new Map<string, { userId: string; name: string }[]>();
    if (rows.length) {
      const jobIds = rows.map((r: any) => r.job_id);
      const [{ data: jobRows }, { data: assigns }] = await Promise.all([
        supabase
          .from('crm_jobs')
          .select('id, contract_amount, invoiced_amount, paid_amount, scheduled_start')
          .in('id', jobIds),
        supabase
          .from('job_assignments')
          .select('job_id, user_id')
          .in('job_id', jobIds)
          .is('released_at', null),
      ]);
      for (const j of jobRows ?? []) financials.set(j.id, j);

      const people = await loadPeople(
        supabase,
        ((assigns ?? []) as { user_id?: string }[]).map((row) => row.user_id),
      );
      for (const row of (assigns ?? []) as { job_id?: string; user_id?: string }[]) {
        if (!row.job_id || !row.user_id) continue;
        const who = people.get(row.user_id);
        const name = who?.fullName || who?.email || 'Crew';
        const list = crewByJob.get(row.job_id) ?? [];
        list.push({ userId: row.user_id, name });
        crewByJob.set(row.job_id, list);
      }
    }

    res.json({
      jobs: rows.map((r: any) => {
        const f = financials.get(r.job_id);
        return {
          ...serializeJobMemory(r),
          contractAmount: f?.contract_amount ?? null,
          invoicedAmount: f?.invoiced_amount ?? null,
          paidAmount: f?.paid_amount ?? null,
          scheduledStart: f?.scheduled_start ?? null,
          crew: crewByJob.get(r.job_id) ?? [],
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/jobs
 * Open a job. Writes to `crm_jobs` — this is the field-facing subset of the
 * fuller CRUD at `/api/crm/jobs`, which also carries financials and the links
 * to accounts, contacts and properties. The per-org job number is assigned by
 * the CRM's own trigger, so it cannot be supplied by the client.
 */
jobsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createJobSchema.parse(req.body);
    const { orgId, supabase } = await requireOrgContext(req);

    const { data, error } = await supabase
      .from('crm_jobs')
      .insert({ ...toColumns(input, JOB_COLUMNS), org_id: orgId })
      .select(JOB_SELECT)
      .single();
    if (error) throw dbError(error, 'Could not open that job.');

    res.status(201).json({ job: serializeJob(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jobs/:id
 * A job and everything hanging off it — the complete picture in one call.
 */
jobsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const jobId = req.params.id;
    const job = await loadJob(supabase, jobId);

    const [tasks, crew, logs, events] = await Promise.all([
      supabase
        .from('job_tasks')
        .select(TASK_SELECT)
        .eq('job_id', jobId)
        .order('position')
        .order('created_at'),
      supabase
        .from('job_assignments')
        .select(ASSIGNMENT_SELECT)
        .eq('job_id', jobId)
        .order('assigned_at', { ascending: false }),
      supabase
        .from('work_logs')
        .select(WORK_LOG_SELECT)
        .eq('job_id', jobId)
        .order('occurred_at', { ascending: false })
        .limit(200),
      supabase
        .from('memory_events')
        .select('*')
        .eq('job_id', jobId)
        .order('seq', { ascending: false })
        .limit(100),
    ]);

    for (const result of [tasks, crew, logs, events]) {
      if (result.error) throw dbError(result.error, 'Could not load that job.');
    }

    // One lookup for every person named anywhere in the response.
    const people = await loadPeople(supabase, [
      job.owner_id,
      ...(tasks.data ?? []).map((t: any) => t.assigned_to),
      ...(crew.data ?? []).map((a: any) => a.user_id),
      ...(logs.data ?? []).map((w: any) => w.author_id),
    ]);

    res.json({
      job: serializeJob(job),
      tasks: (tasks.data ?? []).map((t: any) => serializeTask(t, people)),
      crew: (crew.data ?? []).map((a: any) => serializeAssignment(a, people)),
      workLogs: (logs.data ?? []).map((w: any) => serializeWorkLog(w, people)),
      memory: (events.data ?? []).map(serializeMemoryEvent),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/jobs/:id
 * Only the supplied fields change. The trigger records the field-level diff, so
 * a narrow patch produces a narrow, readable memory entry.
 */
jobsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateJobSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase
      .from('crm_jobs')
      .update(toColumns(input, JOB_COLUMNS))
      .eq('id', req.params.id)
      .select(JOB_SELECT)
      .maybeSingle();
    if (error) throw dbError(error, 'Could not update that job.');
    if (!data) throw new HttpError(404, 'Job not found.', 'job_not_found');

    res.json({ job: serializeJob(data) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jobs/:id/memory
 * The full history of one job, oldest first — the job's own story.
 */
jobsRouter.get('/:id/memory', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    await loadJob(supabase, req.params.id);

    const { data, error } = await supabase
      .from('memory_events')
      .select('*')
      .eq('job_id', req.params.id)
      .order('seq', { ascending: true });
    if (error) throw dbError(error, 'Could not load that history.');

    res.json({ events: (data ?? []).map(serializeMemoryEvent) });
  } catch (err) {
    next(err);
  }
});

/* ==========================================================================
 * Tasks
 * ========================================================================== */

/** POST /api/jobs/:id/tasks — add a task to a job. */
jobsRouter.post('/:id/tasks', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createTaskSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);
    const job = await loadJob(supabase, req.params.id);

    const { data, error } = await supabase
      .from('job_tasks')
      .insert({ ...toColumns(input, TASK_COLUMNS), job_id: job.id, org_id: job.org_id })
      .select(TASK_SELECT)
      .single();
    if (error) throw dbError(error, 'Could not add that task.');

    const people = await loadPeople(supabase, [data.assigned_to]);
    res.status(201).json({ task: serializeTask(data, people) });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/jobs/:id/tasks/:taskId — update a task in place. */
jobsRouter.patch('/:id/tasks/:taskId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateTaskSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase
      .from('job_tasks')
      .update(toColumns(input, TASK_COLUMNS))
      .eq('id', req.params.taskId)
      .eq('job_id', req.params.id)
      .select(TASK_SELECT)
      .maybeSingle();
    if (error) throw dbError(error, 'Could not update that task.');
    if (!data) throw new HttpError(404, 'Task not found.', 'task_not_found');

    const people = await loadPeople(supabase, [data.assigned_to]);
    res.json({ task: serializeTask(data, people) });
  } catch (err) {
    next(err);
  }
});

/* ==========================================================================
 * Crew
 * ========================================================================== */

/** POST /api/jobs/:id/crew — put an agent on the job. */
jobsRouter.post('/:id/crew', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, roleOnJob } = assignAgentSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);
    const job = await loadJob(supabase, req.params.id);

    const { data, error } = await supabase
      .from('job_assignments')
      .insert({
        job_id: job.id,
        org_id: job.org_id,
        user_id: userId,
        role_on_job: roleOnJob ?? 'crew',
      })
      .select(ASSIGNMENT_SELECT)
      .single();
    if (error) {
      // The partial unique index only covers live assignments, so this can only
      // mean they are already on the job.
      if (error.code === '23505') {
        throw new HttpError(409, 'They are already on this job.', 'already_assigned');
      }
      throw dbError(error, 'Could not assign them to that job.');
    }

    const people = await loadPeople(supabase, [data.user_id]);
    res.status(201).json({ assignment: serializeAssignment(data, people) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/jobs/:id/crew/:assignmentId/release
 * Take someone off the job. The row stays — it gains a released_at — so the
 * record of who was on the job during any past window survives.
 */
jobsRouter.post(
  '/:id/crew/:assignmentId/release',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = createUserClient(req.accessToken!);

      const { data, error } = await supabase
        .from('job_assignments')
        .update({ released_at: new Date().toISOString() })
        .eq('id', req.params.assignmentId)
        .eq('job_id', req.params.id)
        .is('released_at', null)
        .select(ASSIGNMENT_SELECT)
        .maybeSingle();
      if (error) throw dbError(error, 'Could not release them from that job.');
      if (!data) throw new HttpError(404, 'That assignment is not active.', 'assignment_not_found');

      const people = await loadPeople(supabase, [data.user_id]);
      res.json({ assignment: serializeAssignment(data, people) });
    } catch (err) {
      next(err);
    }
  },
);

/* ==========================================================================
 * Work logs
 * ========================================================================== */

/** POST /api/jobs/:id/logs — an agent's own account of work done. */
jobsRouter.post('/:id/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createWorkLogSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);
    const job = await loadJob(supabase, req.params.id);

    const { data, error } = await supabase
      .from('work_logs')
      .insert({
        ...toColumns(input, WORK_LOG_COLUMNS),
        job_id: job.id,
        org_id: job.org_id,
        author_id: req.user!.id,
      })
      .select(WORK_LOG_SELECT)
      .single();
    if (error) throw dbError(error, 'Could not save that entry.');

    const people = await loadPeople(supabase, [data.author_id]);
    res.status(201).json({ workLog: serializeWorkLog(data, people) });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/jobs/:id/logs/:logId
 * Only the author may revise their own entry (enforced by RLS, not here). The
 * original text is preserved in the memory event for the edit.
 */
jobsRouter.patch('/:id/logs/:logId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateWorkLogSchema.parse(req.body);
    const supabase = createUserClient(req.accessToken!);

    const { data, error } = await supabase
      .from('work_logs')
      .update(toColumns(input, WORK_LOG_COLUMNS))
      .eq('id', req.params.logId)
      .eq('job_id', req.params.id)
      .select(WORK_LOG_SELECT)
      .maybeSingle();
    if (error) throw dbError(error, 'Could not update that entry.');
    if (!data) {
      throw new HttpError(404, 'That entry is not yours to edit.', 'work_log_not_found');
    }

    const people = await loadPeople(supabase, [data.author_id]);
    res.json({ workLog: serializeWorkLog(data, people) });
  } catch (err) {
    next(err);
  }
});
