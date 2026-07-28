import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Agent Memory — the server's side of the record.
 *
 * Almost nothing here writes memory. Every change to a job, task, assignment or
 * work log is captured by a database trigger, so the record stays complete
 * whether the write came through these routes, a SQL console, or some future
 * client nobody has written yet. What the backend contributes is the handful of
 * events that have no row behind them — signing in, signing out, unlocking with
 * a PIN — via `recordEvent` below.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Event types the backend is permitted to record. The database enforces the
 *  same namespace rule, so a mismatch here fails loudly rather than silently. */
export type AppEventType =
  | 'auth.signed_in'
  | 'auth.signed_out'
  | 'auth.pin_unlocked'
  | 'auth.pin_enrolled'
  | 'auth.pin_disabled'
  | 'auth.password_reset'
  | 'export.memory_downloaded';

export interface RecordEventInput {
  type: AppEventType;
  summary: string;
  entityType?: string;
  entityId?: string | null;
  jobId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Append an event that no table write would have produced.
 *
 * Deliberately never throws. A sign-in that succeeded must not be turned into a
 * 500 because the record of it could not be written — the user is already
 * authenticated by that point, and failing the request would log them out of a
 * session that exists. Failures are surfaced on the server log instead.
 */
export async function recordEvent(
  supabase: SupabaseClient,
  input: RecordEventInput,
): Promise<void> {
  try {
    const { error } = await supabase.rpc('record_memory_event', {
      p_event_type: input.type,
      p_summary: input.summary,
      p_entity_type: input.entityType ?? 'session',
      p_entity_id: input.entityId ?? null,
      p_job_id: input.jobId ?? null,
      p_details: input.details ?? {},
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[memory] could not record %s: %s', input.type, error.message);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[memory] could not record %s:', input.type, err);
  }
}

/* ==========================================================================
 * Serializers — snake_case columns to the camelCase shape the frontend uses.
 * ========================================================================== */

export interface Person {
  id: string;
  email: string | null;
  fullName: string | null;
}

/**
 * Who a user id belongs to.
 *
 * These columns reference `auth.users`, not `public.profiles`, so PostgREST has
 * no foreign key to embed along — the display name has to be resolved
 * separately. `loadPeople` does it in one query per request and the serializers
 * read from the resulting map.
 */
export type PeopleMap = Map<string, Person>;

export async function loadPeople(
  supabase: SupabaseClient,
  ids: (string | null | undefined)[],
): Promise<PeopleMap> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();

  const { data } = await supabase
    .from('profiles')
    .select('id, email, full_name')
    .in('id', unique);

  return new Map(
    (data ?? []).map((p: any) => [
      p.id as string,
      { id: p.id, email: p.email ?? null, fullName: p.full_name ?? null },
    ]),
  );
}

function person(people: PeopleMap | undefined, id: string | null | undefined): Person | null {
  if (!id) return null;
  return people?.get(id) ?? { id, email: null, fullName: null };
}

/** A row from `crm_jobs`. The CRM owns the job record; this is the shape the
 *  field-facing screens need, not the full CRM projection. */
export function serializeJob(j: any) {
  if (!j) return null;
  return {
    id: j.id,
    jobNumber: j.job_number,
    title: j.title,
    description: j.description ?? null,
    workType: j.work_type,
    lossType: j.loss_type ?? null,
    status: j.status,
    priority: j.priority,
    claimNumber: j.claim_number ?? null,
    policyNumber: j.policy_number ?? null,
    ownerId: j.owner_id ?? null,
    contactId: j.contact_id ?? null,
    accountId: j.account_id ?? null,
    propertyId: j.property_id ?? null,
    lossDate: j.loss_date ?? null,
    scheduledStart: j.scheduled_start ?? null,
    scheduledEnd: j.scheduled_end ?? null,
    actualStart: j.actual_start ?? null,
    actualEnd: j.actual_end ?? null,
    contractAmount: j.contract_amount ?? null,
    invoicedAmount: j.invoiced_amount ?? null,
    paidAmount: j.paid_amount ?? null,
    createdBy: j.created_by ?? null,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
  };
}

export function serializeTask(t: any, people?: PeopleMap) {
  if (!t) return null;
  return {
    id: t.id,
    jobId: t.job_id,
    title: t.title,
    details: t.details ?? null,
    status: t.status,
    priority: t.priority,
    assignedTo: t.assigned_to ?? null,
    assignee: person(people, t.assigned_to),
    dueAt: t.due_at ?? null,
    position: t.position,
    completedAt: t.completed_at ?? null,
    completedBy: t.completed_by ?? null,
    createdBy: t.created_by,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

export function serializeAssignment(a: any, people?: PeopleMap) {
  if (!a) return null;
  return {
    id: a.id,
    jobId: a.job_id,
    userId: a.user_id,
    agent: person(people, a.user_id),
    roleOnJob: a.role_on_job,
    assignedBy: a.assigned_by,
    assignedAt: a.assigned_at,
    releasedAt: a.released_at ?? null,
    active: a.released_at == null,
  };
}

export function serializeWorkLog(w: any, people?: PeopleMap) {
  if (!w) return null;
  return {
    id: w.id,
    jobId: w.job_id,
    taskId: w.task_id ?? null,
    kind: w.kind,
    body: w.body,
    minutes: w.minutes ?? null,
    occurredAt: w.occurred_at,
    authorId: w.author_id,
    author: person(people, w.author_id),
    createdAt: w.created_at,
    updatedAt: w.updated_at,
    edited: w.updated_at !== w.created_at,
  };
}

export function serializeMemoryEvent(e: any) {
  if (!e) return null;
  return {
    id: e.id,
    seq: Number(e.seq),
    actorId: e.actor_id ?? null,
    // Denormalised at write time, so this is who they were then — not who they
    // are now. Reading it back off the event is the whole point.
    actorEmail: e.actor_email ?? null,
    actorRole: e.actor_role ?? null,
    eventType: e.event_type,
    entityType: e.entity_type,
    entityId: e.entity_id ?? null,
    jobId: e.job_id ?? null,
    summary: e.summary,
    changes: e.changes ?? {},
    snapshot: e.snapshot ?? null,
    source: e.source,
    occurredAt: e.occurred_at,
  };
}

export function serializeJobMemory(j: any) {
  if (!j) return null;
  return {
    jobId: j.job_id,
    jobNumber: j.job_number,
    title: j.title,
    status: j.status,
    priority: j.priority,
    workType: j.work_type,
    ownerId: j.owner_id ?? null,
    claimNumber: j.claim_number ?? null,
    taskCount: Number(j.task_count ?? 0),
    tasksDone: Number(j.tasks_done ?? 0),
    crewSize: Number(j.crew_size ?? 0),
    minutesLogged: Number(j.minutes_logged ?? 0),
    eventCount: Number(j.event_count ?? 0),
    lastEvent: j.last_event ?? null,
    lastEventAt: j.last_event_at ?? null,
    createdAt: j.created_at,
    updatedAt: j.updated_at,
  };
}

export function serializeAgentMemory(a: any) {
  if (!a) return null;
  return {
    userId: a.user_id,
    email: a.email ?? null,
    fullName: a.full_name ?? null,
    role: a.role,
    workType: a.work_type,
    eventCount: Number(a.event_count ?? 0),
    jobsTouched: Number(a.jobs_touched ?? 0),
    openTasks: Number(a.open_tasks ?? 0),
    tasksCompleted: Number(a.tasks_completed ?? 0),
    minutesLogged: Number(a.minutes_logged ?? 0),
    lastActiveAt: a.last_active_at ?? null,
  };
}

/* ==========================================================================
 * camelCase input to column names
 * ========================================================================== */

/** Copies only the keys actually present, so a PATCH never blanks a field it
 *  did not mention. `null` is a real value here — it clears the column. */
export function toColumns<T extends object>(
  input: T,
  map: Record<keyof T & string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(map) as [keyof T & string, string][]) {
    if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
      out[column] = input[key];
    }
  }
  return out;
}

/** Maps the field-facing job input onto `crm_jobs` columns. */
export const JOB_COLUMNS = {
  title: 'title',
  description: 'description',
  workType: 'work_type',
  lossType: 'loss_type',
  status: 'status',
  priority: 'priority',
  claimNumber: 'claim_number',
  policyNumber: 'policy_number',
  ownerId: 'owner_id',
  scheduledStart: 'scheduled_start',
} as const;

export const TASK_COLUMNS = {
  title: 'title',
  details: 'details',
  status: 'status',
  priority: 'priority',
  assignedTo: 'assigned_to',
  dueAt: 'due_at',
  position: 'position',
} as const;

export const WORK_LOG_COLUMNS = {
  kind: 'kind',
  body: 'body',
  minutes: 'minutes',
  taskId: 'task_id',
  occurredAt: 'occurred_at',
} as const;
