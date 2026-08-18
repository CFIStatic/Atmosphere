import { Router, type Request, type Response, type NextFunction } from 'express';
import { createUserClient } from '../lib/supabase.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { memoryQuerySchema } from '../lib/validation.js';
import { HttpError } from '../lib/errors.js';
import {
  serializeMemoryEvent,
  serializeAgentMemory,
  recordEvent,
  loadPeople,
} from '../lib/memory.js';

/**
 * Reading the memory.
 *
 * The feed is keyed on `seq`, the memory's own monotonic counter, rather than on
 * a timestamp or an offset. Timestamps tie; offsets shift under you when rows
 * arrive mid-scroll and quietly skip entries. A record that claims to be
 * complete cannot afford either, so pagination walks `seq < before` and every
 * page is exact.
 */
export const memoryRouter = Router();

memoryRouter.use(requireAuth);

/* eslint-disable @typescript-eslint/no-explicit-any */

const EVENT_SELECT =
  'id, seq, actor_id, actor_email, actor_role, event_type, entity_type, entity_id, job_id, summary, changes, snapshot, source, occurred_at';

function dbError(error: { message: string }, fallback: string): HttpError {
  return new HttpError(400, error.message || fallback, 'memory_error');
}

/** Attaches `{ id, jobNumber, name }` to events that belong to a job. */
async function attachJobs(supabase: any, events: any[]) {
  const ids = [...new Set(events.map((e) => e.jobId).filter(Boolean))];
  if (ids.length === 0) return events;

  const { data } = await supabase.from('crm_jobs').select('id, job_number, title').in('id', ids);
  const jobs = new Map(
    (data ?? []).map((j: any) => [
      j.id,
      { id: j.id, jobNumber: j.job_number, name: j.title, title: j.title },
    ]),
  );
  return events.map((e) => ({ ...e, job: e.jobId ? (jobs.get(e.jobId) ?? null) : null }));
}

/**
 * GET /api/memory
 * The organization's running memory, newest first.
 *
 * Filters: jobId, actorId, entityType, eventType, since, until, search.
 * Paging:  ?before=<seq>&limit=<n> — `nextCursor` in the response is the value
 *          to pass as `before` for the following page, or null at the end.
 */
memoryRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = memoryQuerySchema.parse(req.query);
    const supabase = createUserClient(req.accessToken!);

    let query = supabase.from('memory_events').select(EVENT_SELECT);

    if (q.jobId) query = query.eq('job_id', q.jobId);
    if (q.actorId) query = query.eq('actor_id', q.actorId);
    if (q.entityType) query = query.eq('entity_type', q.entityType);
    // A bare namespace ('job') matches the family; a full type ('job.created')
    // matches exactly.
    if (q.eventType) {
      query = q.eventType.includes('.')
        ? query.eq('event_type', q.eventType)
        : query.like('event_type', `${q.eventType}.%`);
    }
    if (q.since) query = query.gte('occurred_at', q.since);
    if (q.until) query = query.lte('occurred_at', q.until);
    if (q.search) query = query.ilike('summary', `%${q.search.replace(/[%,]/g, ' ')}%`);
    if (q.before) query = query.lt('seq', q.before);

    // One extra row tells us whether another page exists without a count query.
    const { data, error } = await query.order('seq', { ascending: false }).limit(q.limit + 1);
    if (error) throw dbError(error, 'Could not load the memory.');

    const rows = data ?? [];
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const events = await attachJobs(supabase, page.map(serializeMemoryEvent) as any[]);

    res.json({
      events,
      nextCursor: hasMore ? (page[page.length - 1] as any).seq : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/memory/stats
 * Headline numbers for the memory, plus the breakdown by event family.
 */
memoryRouter.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);

    const [total, agents, recent] = await Promise.all([
      supabase.from('memory_events').select('id', { count: 'exact', head: true }),
      supabase.from('agent_memory').select('*'),
      // Bounded: the breakdown is a "what has been happening lately" panel, not
      // an accounting total, and counting every row per type would need a
      // round trip each.
      supabase
        .from('memory_events')
        .select('event_type, occurred_at')
        .order('seq', { ascending: false })
        .limit(1000),
    ]);

    for (const r of [total, agents, recent]) {
      if (r.error) throw dbError(r.error, 'Could not load memory statistics.');
    }

    const byType: Record<string, number> = {};
    for (const row of (recent.data ?? []) as any[]) {
      byType[row.event_type] = (byType[row.event_type] ?? 0) + 1;
    }

    const agentRows = ((agents.data ?? []) as any[]).map(serializeAgentMemory);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    res.json({
      totalEvents: total.count ?? 0,
      agents: agentRows.length,
      activeToday: agentRows.filter(
        (a) => a && a.lastActiveAt && new Date(a.lastActiveAt).getTime() >= dayAgo,
      ).length,
      minutesLogged: agentRows.reduce((sum, a) => sum + (a?.minutesLogged ?? 0), 0),
      eventsInWindow: (recent.data ?? []).length,
      byType,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/memory/agents
 * Every agent in the organization with their work rolled up.
 */
memoryRouter.get('/agents', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase.from('agent_memory').select('*');
    if (error) throw dbError(error, 'Could not load the team.');

    const agents = ((data ?? []) as any[])
      .map(serializeAgentMemory)
      .sort((a, b) => (b?.eventCount ?? 0) - (a?.eventCount ?? 0));

    res.json({ agents });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/memory/agents/:userId
 * One agent: their rollup, their open tasks, and their trail through the memory.
 */
memoryRouter.get('/agents/:userId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = memoryQuerySchema.parse(req.query);
    const supabase = createUserClient(req.accessToken!);
    const { userId } = req.params;

    const summary = await supabase
      .from('agent_memory')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (summary.error) throw dbError(summary.error, 'Could not load that agent.');
    if (!summary.data) throw new HttpError(404, 'That agent is not in your organization.', 'agent_not_found');

    let feed = supabase.from('memory_events').select(EVENT_SELECT).eq('actor_id', userId);
    if (q.before) feed = feed.lt('seq', q.before);

    const [events, tasks] = await Promise.all([
      feed.order('seq', { ascending: false }).limit(q.limit + 1),
      supabase
        .from('job_tasks')
        .select('*')
        .eq('assigned_to', userId)
        .not('status', 'in', '("done","cancelled")')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(50),
    ]);

    for (const r of [events, tasks]) {
      if (r.error) throw dbError(r.error, 'Could not load that agent.');
    }

    const rows = events.data ?? [];
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;

    res.json({
      agent: serializeAgentMemory(summary.data),
      openTasks: tasks.data ?? [],
      events: await attachJobs(supabase, page.map(serializeMemoryEvent) as any[]),
      nextCursor: hasMore ? (page[page.length - 1] as any).seq : null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/memory/export
 * The whole memory as newline-delimited JSON.
 *
 * Streamed in pages so the response size is bounded by the connection rather
 * than by memory, and the export is itself recorded — a complete record has to
 * include the fact that somebody took a copy of it.
 */
memoryRouter.get('/export', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="atmosphere-memory-${stamp}.ndjson"`);

    const PAGE = 500;
    let cursor: number | null = null;
    let exported = 0;

    for (;;) {
      let query = supabase.from('memory_events').select(EVENT_SELECT);
      if (cursor !== null) query = query.lt('seq', cursor);

      const { data, error } = await query.order('seq', { ascending: false }).limit(PAGE);
      if (error) throw dbError(error, 'Could not export the memory.');

      const rows = data ?? [];
      if (rows.length === 0) break;

      for (const row of rows) {
        res.write(`${JSON.stringify(serializeMemoryEvent(row))}\n`);
      }
      exported += rows.length;
      cursor = (rows[rows.length - 1] as any).seq;

      if (rows.length < PAGE) break;
    }

    res.end();

    await recordEvent(supabase, {
      type: 'export.memory_downloaded',
      summary: `exported ${exported} memory ${exported === 1 ? 'event' : 'events'}`,
      details: { count: exported },
    });
  } catch (err) {
    // Once bytes are on the wire the status line is already sent; all that is
    // left is to cut the stream so the client sees a truncated file rather than
    // a silently short one.
    if (res.headersSent) {
      res.destroy(err instanceof Error ? err : new Error('export failed'));
      return;
    }
    next(err);
  }
});

/**
 * GET /api/memory/entity/:entityType/:entityId
 * Everything the memory holds about one specific thing.
 */
memoryRouter.get(
  '/entity/:entityType/:entityId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const supabase = createUserClient(req.accessToken!);
      const { data, error } = await supabase
        .from('memory_events')
        .select(EVENT_SELECT)
        .eq('entity_type', req.params.entityType)
        .eq('entity_id', req.params.entityId)
        .order('seq', { ascending: true });
      if (error) throw dbError(error, 'Could not load that history.');

      const events = (data ?? []).map(serializeMemoryEvent) as any[];
      const people = await loadPeople(supabase, events.map((e) => e.actorId));

      res.json({
        events: events.map((e) => ({ ...e, actor: e.actorId ? (people.get(e.actorId) ?? null) : null })),
      });
    } catch (err) {
      next(err);
    }
  },
);
