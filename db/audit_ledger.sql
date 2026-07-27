-- ============================================================================
-- Atmosphere — Audit ledger
--
-- One org-scoped, append-only record of every unit of work performed by every
-- agent, broken into the ordered steps that produced it. This is what the
-- Audit tab reads.
--
-- Run this once against the Supabase project (SQL editor, or psql). It is
-- idempotent: re-running it is safe.
--
--   agent_runs       — one row per task an agent was asked to perform.
--   agent_run_steps  — the ordered trace of that task, one row per step.
--
-- Why a ledger of its own rather than reading each agent's tables?
--
--   • Agents differ in where they keep state, and some keep none at all. Web
--     Access writes `web_runs`; Computer Use holds runs in memory and evicts
--     them after 40; the technician assistant persists nothing. An audit trail
--     that only covers the agents that happened to write to Postgres is not an
--     audit trail.
--   • An audit record has to outlive the feature that produced it, so it must
--     not be a foreign key into that feature's tables. Runs carry a *soft*
--     provenance pointer (source_table / source_id) instead — the row survives
--     even if the originating feature's table is dropped.
--   • Auditors ask across agents ("what touched this org last Tuesday"), not
--     per agent, and that question should be one indexed query.
--
-- Append-only is enforced at the database layer, not by convention:
--   • Steps have no UPDATE and no DELETE policy — once written, a step is
--     evidence and cannot be rewritten by anyone holding a user JWT.
--   • Runs have no DELETE policy, and a trigger freezes their identity columns
--     and refuses to move a run out of a terminal status.
-- A ledger that the thing being audited can edit afterwards is decoration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,

  -- Stable machine key for the agent ('web_access', 'computer_use', …). The
  -- display name, blurb and colour live in the backend catalog, not here, so
  -- renaming an agent never requires a migration or rewrites history.
  agent_key     text not null check (agent_key ~ '^[a-z][a-z0-9_]{1,48}$'),
  -- What this agent was pointed at for this run: the connection label, the
  -- machine name, the external source. Free text, may be null.
  agent_label   text check (agent_label is null or char_length(agent_label) <= 120),

  -- Who set the work in motion. 'agent' covers an agent that spawned another.
  actor_type    text not null default 'user'
                  check (actor_type in ('user', 'system', 'schedule', 'agent')),
  actor_user_id uuid references auth.users (id) on delete set null,
  -- Denormalised label for a non-user actor ('nightly backup', 'webhook').
  actor_label   text check (actor_label is null or char_length(actor_label) <= 120),

  -- Set when one run was started by another, so nested work reads as a tree.
  parent_run_id uuid references public.agent_runs (id) on delete cascade,

  title         text not null check (char_length(title) between 1 and 500),
  summary       text check (summary is null or char_length(summary) <= 4000),

  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),

  input         jsonb,
  result        jsonb,
  error         text,

  -- Maintained by trigger from the steps themselves — never trusted from the
  -- caller, so the count on a run always matches the rows behind it.
  step_count    integer not null default 0 check (step_count >= 0),
  input_tokens  bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),

  -- Soft provenance. Deliberately not a foreign key: see the header.
  source_table  text check (source_table is null or char_length(source_table) <= 63),
  source_id     uuid,

  started_at    timestamptz,
  finished_at   timestamptz,
  duration_ms   integer check (duration_ms is null or duration_ms >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One ledger row per mirrored source row, so a bridge can upsert on every
-- update of the source without duplicating the run.
create unique index if not exists agent_runs_source_idx
  on public.agent_runs (source_table, source_id)
  where source_table is not null;

-- The Audit tab's three access patterns: newest-first for an org, and the same
-- narrowed by agent or by status.
create index if not exists agent_runs_org_created_idx
  on public.agent_runs (org_id, created_at desc);
create index if not exists agent_runs_org_agent_idx
  on public.agent_runs (org_id, agent_key, created_at desc);
create index if not exists agent_runs_org_status_idx
  on public.agent_runs (org_id, status, created_at desc);
create index if not exists agent_runs_parent_idx
  on public.agent_runs (parent_run_id)
  where parent_run_id is not null;

-- ---------------------------------------------------------------------------
-- Steps
-- ---------------------------------------------------------------------------
create table if not exists public.agent_run_steps (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.agent_runs (id) on delete cascade,
  -- Denormalised so the RLS policy is a single indexed predicate rather than a
  -- join back to the parent on every row. Set from the run by trigger, never
  -- from the caller, so it cannot be used to file a step under another org.
  org_id      uuid not null references public.orgs (id) on delete cascade,

  seq         integer not null check (seq > 0),

  -- 'event' is the catch-all. An agent emitting a kind we have not modelled
  -- yet must still land in the ledger — dropping the step would be the one
  -- outcome an audit trail cannot afford.
  type        text not null default 'event'
                check (type in ('status', 'thought', 'message', 'tool_call', 'tool_result',
                                'observation', 'navigation', 'decision', 'artifact',
                                'usage', 'error', 'event')),

  action      text check (action is null or char_length(action) <= 120),
  detail      text check (detail is null or char_length(detail) <= 8000),
  -- What the step acted on: a URL, a selector, a table name, a file path.
  target      text check (target is null or char_length(target) <= 2000),
  -- Structured arguments/results. Size-capped and secret-redacted by the
  -- backend before it ever gets here (see backend/src/lib/auditLog.ts).
  payload     jsonb,

  status      text not null default 'ok' check (status in ('ok', 'error', 'pending')),
  error       text,

  started_at  timestamptz,
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  created_at  timestamptz not null default now(),

  unique (run_id, seq)
);

create index if not exists agent_run_steps_run_idx on public.agent_run_steps (run_id, seq);
create index if not exists agent_run_steps_org_idx on public.agent_run_steps (org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Integrity triggers
--
-- Every function below pins an empty search_path and schema-qualifies every
-- function it calls: otherwise the caller's schema list decides which `now()`
-- runs, and a shadowing function in an attacker-controlled schema is reachable
-- from a trigger. Same rule as public.web_access_touch_updated_at().
--
-- coalesce / nullif / greatest / extract stay bare because they are SQL
-- expression syntax rather than resolvable names — they cannot be qualified,
-- and for the same reason they cannot be shadowed.
-- ---------------------------------------------------------------------------

/**
 * Freezes what a run *is* while letting it report progress.
 *
 * Identity (org, agent, provenance, parentage, creation time) is immutable, and
 * a finished run cannot be reopened or re-decided. Without this, "succeeded"
 * means only "succeeded the last time someone wrote to the row".
 */
create or replace function public.agent_runs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.agent_key is distinct from old.agent_key
     or new.source_table is distinct from old.source_table
     or new.source_id is distinct from old.source_id
     or new.parent_run_id is distinct from old.parent_run_id
     or new.created_at is distinct from old.created_at then
    raise exception 'agent_runs: identity columns are immutable'
      using errcode = 'restrict_violation';
  end if;

  if old.status in ('succeeded', 'failed', 'cancelled')
     and new.status is distinct from old.status then
    raise exception 'agent_runs: run % is already %, its outcome cannot be changed',
      old.id, old.status
      using errcode = 'restrict_violation';
  end if;

  -- Counters only ever climb. A shrinking step count would mean the trace no
  -- longer accounts for everything the run did.
  if new.step_count < old.step_count
     or new.input_tokens < old.input_tokens
     or new.output_tokens < old.output_tokens then
    raise exception 'agent_runs: counters cannot decrease'
      using errcode = 'restrict_violation';
  end if;

  if new.duration_ms is null and new.finished_at is not null and new.started_at is not null then
    new.duration_ms := greatest(
      0, (extract(epoch from (new.finished_at - new.started_at)) * 1000)::integer);
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists agent_runs_guard_trg on public.agent_runs;
create trigger agent_runs_guard_trg
  before update on public.agent_runs
  for each row execute function public.agent_runs_guard();

/**
 * Fills in a step's derivable fields: the org it belongs to (taken from the
 * run, never the caller), its position in the trace, and its duration.
 *
 * The seq fallback races if two writers append to one run at the same instant;
 * the unique (run_id, seq) index turns that into a failed insert rather than
 * two steps claiming the same position. Backends that fan out should number
 * their own steps.
 */
create or replace function public.agent_run_steps_fill()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select r.org_id into new.org_id from public.agent_runs r where r.id = new.run_id;

  if new.seq is null then
    select coalesce(pg_catalog.max(s.seq), 0) + 1 into new.seq
    from public.agent_run_steps s where s.run_id = new.run_id;
  end if;

  if new.duration_ms is null and new.finished_at is not null and new.started_at is not null then
    new.duration_ms := greatest(
      0, (extract(epoch from (new.finished_at - new.started_at)) * 1000)::integer);
  end if;

  return new;
end;
$$;

drop trigger if exists agent_run_steps_fill_trg on public.agent_run_steps;
create trigger agent_run_steps_fill_trg
  before insert on public.agent_run_steps
  for each row execute function public.agent_run_steps_fill();

/** Keeps agent_runs.step_count honest by deriving it from the rows themselves. */
create or replace function public.agent_run_steps_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.agent_runs
     set step_count = step_count + 1
   where id = new.run_id;
  return null;
end;
$$;

drop trigger if exists agent_run_steps_count_trg on public.agent_run_steps;
create trigger agent_run_steps_count_trg
  after insert on public.agent_run_steps
  for each row execute function public.agent_run_steps_count();

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Read and append for members of the owning org; nothing else, for anyone.
-- Membership is read straight off org_members, whose own policies still apply
-- to the subquery — so this cannot be used to widen a caller's view, and since
-- neither policy reads the table it protects there is no recursion.
--
-- Note what is absent: no DELETE policy on either table, and no UPDATE policy
-- on steps. A user JWT cannot erase or rewrite a trace. Server-side jobs that
-- legitimately need to bypass RLS (a scheduled backup with no user session) go
-- through the service-role client, which is server-only by construction.
-- ---------------------------------------------------------------------------
alter table public.agent_runs      enable row level security;
alter table public.agent_run_steps enable row level security;

drop policy if exists agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs
  for select
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

drop policy if exists agent_runs_insert on public.agent_runs;
create policy agent_runs_insert on public.agent_runs
  for insert
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

drop policy if exists agent_runs_update on public.agent_runs;
create policy agent_runs_update on public.agent_runs
  for update
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()))
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

drop policy if exists agent_run_steps_select on public.agent_run_steps;
create policy agent_run_steps_select on public.agent_run_steps
  for select
  using (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

drop policy if exists agent_run_steps_insert on public.agent_run_steps;
create policy agent_run_steps_insert on public.agent_run_steps
  for insert
  with check (org_id in (select om.org_id from public.org_members om where om.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Rollups
--
-- The Audit tab opens on "how is every agent doing", which is an aggregate over
-- potentially every run an org has ever recorded. Both functions below are
-- SECURITY INVOKER, so RLS still decides which rows they can see — a caller
-- gets totals for their own org and cannot compute another's by passing its id.
-- ---------------------------------------------------------------------------

create or replace function public.agent_audit_rollup(p_org uuid)
returns table (
  agent_key       text,
  total           bigint,
  succeeded       bigint,
  failed          bigint,
  active          bigint,
  steps           bigint,
  last_run_at     timestamptz,
  avg_duration_ms numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.agent_key,
         count(*)::bigint,
         count(*) filter (where r.status = 'succeeded')::bigint,
         count(*) filter (where r.status = 'failed')::bigint,
         count(*) filter (where r.status in ('queued', 'running'))::bigint,
         coalesce(sum(r.step_count), 0)::bigint,
         max(r.created_at),
         avg(r.duration_ms)
    from public.agent_runs r
   where r.org_id = p_org
   group by r.agent_key;
$$;

/**
 * The Audit tab's filtered run list, newest first.
 *
 * A function rather than a PostgREST query for two reasons. Keyset pagination
 * needs a row comparison — (created_at, id) < (cursor) — which the REST filter
 * grammar can only approximate with a nested or/and whose value quoting is
 * fiddly for timestamps; and the actor's email needs a join that PostgREST
 * cannot embed, because actor_user_id references auth.users rather than
 * profiles. Both are one clean line of SQL here.
 *
 * SECURITY INVOKER, so RLS still decides which runs exist for this caller.
 */
create or replace function public.agent_audit_runs(
  p_org         uuid,
  p_agent       text default null,
  p_status      text default null,
  p_actor_type  text default null,
  p_actor_user  uuid default null,
  p_q           text default null,
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_limit       integer default 25,
  p_cursor_at   timestamptz default null,
  p_cursor_id   uuid default null
)
returns table (
  id            uuid,
  agent_key     text,
  agent_label   text,
  actor_type    text,
  actor_user_id uuid,
  actor_email   text,
  actor_label   text,
  parent_run_id uuid,
  title         text,
  summary       text,
  status        text,
  error         text,
  step_count    integer,
  input_tokens  bigint,
  output_tokens bigint,
  source_table  text,
  source_id     uuid,
  started_at    timestamptz,
  finished_at   timestamptz,
  duration_ms   integer,
  created_at    timestamptz,
  updated_at    timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.id, r.agent_key, r.agent_label, r.actor_type, r.actor_user_id,
         p.email, r.actor_label, r.parent_run_id, r.title, r.summary,
         r.status, r.error, r.step_count, r.input_tokens, r.output_tokens,
         r.source_table, r.source_id, r.started_at, r.finished_at,
         r.duration_ms, r.created_at, r.updated_at
    from public.agent_runs r
    left join public.profiles p on p.id = r.actor_user_id
   where r.org_id = p_org
     and (p_agent      is null or r.agent_key     = p_agent)
     and (p_status     is null or r.status        = p_status)
     and (p_actor_type is null or r.actor_type    = p_actor_type)
     and (p_actor_user is null or r.actor_user_id = p_actor_user)
     and (p_from       is null or r.created_at   >= p_from)
     and (p_to         is null or r.created_at   <= p_to)
     -- The search term is escaped so a user typing '%' searches for a percent
     -- sign rather than matching every run in the ledger.
     and (p_q is null
          or r.title       ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or r.agent_label ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
          or r.summary     ilike '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     -- Keyset, not offset: the ledger is appended to constantly, and with
     -- OFFSET a run inserted mid-scroll shifts every later page by one, so the
     -- reader silently skips a row. The id breaks ties between runs written in
     -- the same transaction, which the bridges do routinely.
     and (p_cursor_at is null or (r.created_at, r.id) < (p_cursor_at, p_cursor_id))
   order by r.created_at desc, r.id desc
   limit p_limit;
$$;

create or replace function public.agent_audit_stats(p_org uuid)
returns table (
  total_runs     bigint,
  active_runs    bigint,
  failed_runs    bigint,
  succeeded_runs bigint,
  total_steps    bigint,
  input_tokens   numeric,
  output_tokens  numeric,
  runs_24h       bigint,
  agents_seen    bigint,
  last_run_at    timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::bigint,
         count(*) filter (where r.status in ('queued', 'running'))::bigint,
         count(*) filter (where r.status = 'failed')::bigint,
         count(*) filter (where r.status = 'succeeded')::bigint,
         coalesce(sum(r.step_count), 0)::bigint,
         coalesce(sum(r.input_tokens), 0)::numeric,
         coalesce(sum(r.output_tokens), 0)::numeric,
         count(*) filter (where r.created_at > pg_catalog.now() - interval '24 hours')::bigint,
         count(distinct r.agent_key)::bigint,
         max(r.created_at)
    from public.agent_runs r
   where r.org_id = p_org;
$$;

-- ============================================================================
-- Bridges
--
-- Agents that already keep their own run table are mirrored into the ledger by
-- trigger rather than by asking each feature to double-write. Two reasons:
-- the mirror cannot drift from the source, and it captures runs from code that
-- has not been changed to know the ledger exists.
--
-- Every bridge swallows its own errors. An audit trail is not worth failing
-- the work it is recording — a lost trace is a gap, a failed insert is an
-- outage — so a broken bridge degrades to silence and the source write
-- proceeds.
--
-- Bridges install only for tables that exist (see audit_install_bridges at the
-- bottom). Atmosphere's agents ship on separate branches; run that function
-- again after one merges to pick up its table.
-- ============================================================================

/**
 * Web Access — public.web_runs.
 *
 * Its `steps` column is a jsonb array of {index, action, detail, url, error?}
 * rewritten wholesale on each update, so steps are inserted with ON CONFLICT
 * DO NOTHING: the ledger keeps the first version of step N it ever saw.
 */
create or replace function public.audit_bridge_web_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_step   jsonb;
  v_seq    integer := 0;
begin
  insert into public.agent_runs (
    org_id, agent_key, agent_label, actor_type, actor_user_id, title, status,
    input, result, error, source_table, source_id, started_at, finished_at)
  values (
    new.org_id,
    'web_access',
    (select c.label from public.web_connections c where c.id = new.connection_id),
    'user',
    new.created_by,
    new.instruction,
    new.status,
    pg_catalog.jsonb_build_object('kind', new.kind, 'inputData', new.input_data),
    new.result,
    new.error,
    'web_runs',
    new.id,
    new.started_at,
    new.finished_at)
  on conflict (source_table, source_id) where source_table is not null
  do update set
    status      = excluded.status,
    result      = excluded.result,
    error       = excluded.error,
    started_at  = excluded.started_at,
    finished_at = excluded.finished_at
  returning id into v_run_id;

  for v_step in
    select value from pg_catalog.jsonb_array_elements(coalesce(new.steps, '[]'::jsonb))
  loop
    v_seq := coalesce((v_step->>'index')::integer, v_seq + 1);
    insert into public.agent_run_steps (run_id, seq, type, action, detail, target, status, error)
    values (
      v_run_id,
      v_seq,
      case when nullif(v_step->>'error', '') is not null then 'error' else 'tool_call' end,
      v_step->>'action',
      v_step->>'detail',
      v_step->>'url',
      case when nullif(v_step->>'error', '') is not null then 'error' else 'ok' end,
      nullif(v_step->>'error', ''))
    on conflict (run_id, seq) do nothing;
  end loop;

  return null;
exception when others then
  raise warning 'audit bridge (web_runs) skipped run %: %', new.id, sqlerrm;
  return null;
end;
$$;

/**
 * CRM external mirror — public.crm_sync_runs.
 *
 * A sync has no per-action trace of its own, so its outcome counters become the
 * step: one 'observation' summarising what the pull saw, which is the whole of
 * what that agent can honestly report.
 */
create or replace function public.audit_bridge_crm_sync_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  insert into public.agent_runs (
    org_id, agent_key, agent_label, actor_type, actor_user_id, title, status,
    result, error, source_table, source_id, started_at, finished_at)
  values (
    new.org_id,
    'crm_sync',
    (select s.name from public.crm_external_sources s where s.id = new.source_id),
    case when new.trigger_kind = 'manual' then 'user' else 'schedule' end,
    new.started_by,
    'Pull from external source',
    case new.status::text
      when 'running'   then 'running'
      when 'succeeded' then 'succeeded'
      when 'partial'   then 'succeeded'
      else 'failed' end,
    pg_catalog.jsonb_build_object(
      'seen', new.records_seen, 'new', new.records_new,
      'changed', new.records_changed, 'failed', new.records_failed,
      'outcome', new.status::text),
    new.error,
    'crm_sync_runs',
    new.id,
    new.started_at,
    new.finished_at)
  on conflict (source_table, source_id) where source_table is not null
  do update set
    status      = excluded.status,
    result      = excluded.result,
    error       = excluded.error,
    finished_at = excluded.finished_at
  returning id into v_run_id;

  if new.finished_at is not null then
    insert into public.agent_run_steps (run_id, seq, type, action, detail, status, error)
    values (
      v_run_id, 1, 'observation', 'sync',
      pg_catalog.format('%s seen · %s new · %s changed · %s failed',
        new.records_seen, new.records_new, new.records_changed, new.records_failed),
      case when new.status::text in ('succeeded', 'partial') then 'ok' else 'error' end,
      new.error)
    on conflict (run_id, seq) do nothing;
  end if;

  return null;
exception when others then
  raise warning 'audit bridge (crm_sync_runs) skipped run %: %', new.id, sqlerrm;
  return null;
end;
$$;

/**
 * Backups — public.backup_snapshots, with backup_snapshot_items as its steps.
 *
 * Platform-wide snapshots (org_id null) are skipped: the ledger is org-scoped
 * by design, and there is no org whose members should be shown a run that
 * spans every org's data.
 */
create or replace function public.audit_bridge_backup_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_item   record;
  v_seq    integer := 0;
begin
  if new.org_id is null then
    return null;
  end if;

  insert into public.agent_runs (
    org_id, agent_key, agent_label, actor_type, actor_user_id, title, status,
    result, error, source_table, source_id, started_at, finished_at, duration_ms)
  values (
    new.org_id,
    'backup',
    new.storage_driver,
    case when new.kind::text = 'manual' then 'user' else 'schedule' end,
    new.created_by,
    pg_catalog.format('%s backup', new.kind),
    case new.status::text
      when 'running'   then 'running'
      when 'completed' then 'succeeded'
      when 'expired'   then 'cancelled'
      else 'failed' end,
    pg_catalog.jsonb_build_object(
      'tables', new.table_count, 'rows', new.row_count,
      'bytes', new.byte_size, 'sha256', new.content_sha256,
      'verifiedAt', new.verified_at, 'verifyOk', new.verify_ok),
    new.error,
    'backup_snapshots',
    new.id,
    new.started_at,
    new.finished_at,
    new.duration_ms)
  on conflict (source_table, source_id) where source_table is not null
  do update set
    status      = excluded.status,
    result      = excluded.result,
    error       = excluded.error,
    finished_at = excluded.finished_at
  returning id into v_run_id;

  for v_item in
    select * from public.backup_snapshot_items i
    where i.snapshot_id = new.id order by i.table_name
  loop
    v_seq := v_seq + 1;
    insert into public.agent_run_steps (run_id, seq, type, action, detail, target, status, error)
    values (
      v_run_id, v_seq, 'artifact', 'archive',
      pg_catalog.format('%s rows', coalesce(v_item.row_count, 0)),
      v_item.table_name,
      case when v_item.error is null then 'ok' else 'error' end,
      v_item.error)
    on conflict (run_id, seq) do nothing;
  end loop;

  return null;
exception when others then
  raise warning 'audit bridge (backup_snapshots) skipped snapshot %: %', new.id, sqlerrm;
  return null;
end;
$$;

/**
 * Installs every bridge whose source table exists, and skips the rest.
 *
 * Atmosphere's agents ship on separate branches, so which of these tables is
 * present depends on what has merged. Calling this again after a merge is safe
 * and is how a newly arrived agent starts being audited:
 *
 *   select public.audit_install_bridges();
 */
create or replace function public.audit_install_bridges()
returns text
language plpgsql
as $$
declare
  v_installed text[] := '{}';
  v_skipped   text[] := '{}';
begin
  if to_regclass('public.web_runs') is not null then
    execute 'drop trigger if exists audit_bridge_trg on public.web_runs';
    execute 'create trigger audit_bridge_trg after insert or update on public.web_runs '
            'for each row execute function public.audit_bridge_web_runs()';
    v_installed := v_installed || 'web_runs'::text;
  else
    v_skipped := v_skipped || 'web_runs'::text;
  end if;

  if to_regclass('public.crm_sync_runs') is not null
     and to_regclass('public.crm_external_sources') is not null then
    execute 'drop trigger if exists audit_bridge_trg on public.crm_sync_runs';
    execute 'create trigger audit_bridge_trg after insert or update on public.crm_sync_runs '
            'for each row execute function public.audit_bridge_crm_sync_runs()';
    v_installed := v_installed || 'crm_sync_runs'::text;
  else
    v_skipped := v_skipped || 'crm_sync_runs'::text;
  end if;

  if to_regclass('public.backup_snapshots') is not null
     and to_regclass('public.backup_snapshot_items') is not null then
    execute 'drop trigger if exists audit_bridge_trg on public.backup_snapshots';
    execute 'create trigger audit_bridge_trg after insert or update on public.backup_snapshots '
            'for each row execute function public.audit_bridge_backup_snapshots()';
    v_installed := v_installed || 'backup_snapshots'::text;
  else
    v_skipped := v_skipped || 'backup_snapshots'::text;
  end if;

  return pg_catalog.format('installed: %s; not present yet: %s',
    coalesce(pg_catalog.array_to_string(v_installed, ', '), 'none'),
    coalesce(pg_catalog.array_to_string(v_skipped, ', '), 'none'));
end;
$$;

select public.audit_install_bridges();
