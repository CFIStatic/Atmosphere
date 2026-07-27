-- ============================================================================
-- Project Manager Agent
-- ============================================================================
-- The production side of Atmosphere: what happens after a job is sold. A project
-- manager runs several jobs at once, and the work that slips is never the work
-- they are looking at — it is the reading nobody took on Tuesday, the
-- authorization form nobody chased, the dehumidifier still billing on a job that
-- dried out last week.
--
-- So this schema is shaped around one idea: everything a PM would otherwise have
-- to remember is a row, and every row carries enough structure for a rule to
-- check it. `pm_alerts` is where those checks land.
--
-- Conventions, matching the rest of the project:
--   * Every table is org-scoped and RLS-protected; reads and writes happen under
--     the caller's JWT, never the service-role key.
--   * Nothing is deleted. Projects are cancelled, equipment is retired,
--     assignments are released, alerts are resolved. A PM's questions are almost
--     always historical ("when did that dry out?"), and a DELETE loses the answer.
--   * Status/enum-like columns are `text` + CHECK rather than Postgres enums, so
--     adding a phase later is a one-line migration instead of an enum dance.
--     (This follows the newer `web_*`/`agent_*` tables.)
--   * Money is integer cents. Never floats.
-- ============================================================================

-- `private` holds the SECURITY DEFINER helpers that the policies call. Neither
-- `anon` nor `authenticated` has USAGE on it, and that stays true: because
-- Postgres grants EXECUTE on new functions to PUBLIC by default, opening the
-- schema would expose every helper in it, including the billing ones. Nothing
-- below calls a `private.*` function from a context that runs as the caller —
-- policy expressions and SECURITY DEFINER triggers are the only callers.
create schema if not exists private;

-- ----------------------------------------------------------------------------
-- 0. Shared helpers
-- ----------------------------------------------------------------------------
-- These already exist in the hosted Atmosphere project. They are re-declared
-- here, byte-identical, so a fresh clone can rebuild the schema from
-- `supabase/migrations/` alone — `create or replace` over an identical body is a
-- no-op against the live project.

create or replace function private.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.org_members
    where org_id = p_org and user_id = auth.uid()
  );
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path to ''
as $$
begin new.updated_at := pg_catalog.now(); return new; end;
$$;

-- The caller's org. Used as a column default so callers never have to pass
-- `org_id` and therefore can never pass someone else's — the RLS policies would
-- reject it anyway, but a default that is always right beats an error.
create or replace function private.pm_current_org()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select om.org_id
  from public.org_members om
  where om.user_id = auth.uid()
  order by om.created_at
  limit 1;
$$;

-- Who may change the plan, as opposed to merely reporting against it.
--
-- Field technicians deliberately are not on this list: they log readings, place
-- equipment, attach photos and close out their own tasks (all permitted below),
-- but they do not move a project's phase or rewrite its schedule. Sales is
-- excluded for the same reason — their write access ends at `won`.
create or replace function private.pm_can_manage(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org
      and m.user_id = auth.uid()
      and m.role in ('project_manager', 'office_manager')
  ) or exists (
    select 1 from public.orgs o
    where o.id = p_org and o.created_by = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- 1. Projects
-- ----------------------------------------------------------------------------
-- `status` is the lifecycle (is anyone working on this?) and `phase` is the
-- position in the workflow. Keeping them apart is what lets a project be
-- `on_hold` during `drying` without inventing an `on_hold_drying` state, and it
-- gives the playbook a single clean key to generate tasks from.
--
-- The phase CHECK is the union of the mitigation and construction workflows;
-- which phases are legal for which work type is enforced in the application
-- (backend/src/pm/playbooks.ts), because that mapping changes far more often
-- than the database should.

create table if not exists public.pm_projects (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),

  -- Per-org running number, assigned by trigger. PMs refer to jobs by number on
  -- the phone; a UUID is unusable for that.
  seq_no          integer not null,
  project_number  text    not null,

  name            text not null check (length(btrim(name)) between 2 and 160),
  description     text check (description is null or length(description) <= 4000),

  work_type       text not null check (work_type in ('mitigation', 'construction')),
  loss_type       text check (loss_type in ('water', 'fire', 'mold', 'storm', 'biohazard', 'remodel', 'other')),

  status          text not null default 'active'
                    check (status in ('active', 'on_hold', 'closed', 'cancelled')),
  phase           text not null default 'intake'
                    check (phase in (
                      -- shared
                      'intake', 'inspection', 'approval', 'scheduled',
                      -- mitigation
                      'mitigation', 'drying', 'drying_complete',
                      -- construction
                      'permitting', 'production', 'punch_list',
                      -- shared close-out
                      'final_review', 'invoicing', 'paid'
                    )),
  priority        text not null default 'normal'
                    check (priority in ('low', 'normal', 'high', 'urgent')),

  -- The PM who owns this project. Nullable so a job can be opened before it is
  -- allocated; `pm_unassigned` in the rule set exists to make sure it does not stay that way.
  pm_user_id      uuid references auth.users(id),

  customer_name   text,
  customer_phone  text,
  customer_email  text,
  address_line1   text,
  address_line2   text,
  city            text,
  region          text,
  postal_code     text,

  -- Insurance. All nullable: a cash construction job has none of it.
  carrier         text,
  claim_number    text,
  adjuster_name   text,
  adjuster_email  text,
  adjuster_phone  text,
  deductible_cents   bigint check (deductible_cents is null or deductible_cents >= 0),
  approved_amount_cents bigint check (approved_amount_cents is null or approved_amount_cents >= 0),

  loss_at            timestamptz,
  scheduled_start_at timestamptz,
  target_completion_at timestamptz,
  started_at         timestamptz,
  completed_at       timestamptz,
  closed_at          timestamptz,

  -- Set when the project came from a sold lead. Intentionally *not* a foreign
  -- key: `leads` lives on the Sales branch and this branch must apply on its
  -- own. A dangling id is a smaller problem than a migration that cannot run.
  source_lead_id  uuid,

  created_by      uuid not null default auth.uid() references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint pm_projects_seq_unique    unique (org_id, seq_no),
  constraint pm_projects_number_unique unique (org_id, project_number)
);

comment on table public.pm_projects is
  'A job in production, owned by a project manager. Cancelled or closed, never deleted.';

-- "Does this project belong to that org?" — asked from the policies of every
-- child table. SECURITY DEFINER because a plain subquery against pm_projects
-- from inside a policy would re-enter the pm_projects policies. Declared here
-- rather than with the other helpers because a `language sql` body is validated
-- when it is created, and pm_projects has to exist first.
create or replace function private.pm_project_in_org(p_project uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.pm_projects p
    where p.id = p_project and p.org_id = p_org
  );
$$;

create index if not exists pm_projects_org_status_idx on public.pm_projects (org_id, status, phase);
create index if not exists pm_projects_pm_idx         on public.pm_projects (org_id, pm_user_id, status);
create index if not exists pm_projects_target_idx     on public.pm_projects (org_id, target_completion_at)
  where status = 'active';

-- Assigns org_id and the next per-org project number. The advisory lock is
-- transaction-scoped and keyed on the org, so two PMs opening a project at the
-- same instant serialise against each other and against nobody else.
create or replace function private.pm_assign_project_number()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.org_id is null then
    new.org_id := private.pm_current_org();
  end if;
  if new.org_id is null then
    raise exception 'you must belong to an organization before opening a project'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('pm_projects:' || new.org_id::text, 0));
  select coalesce(max(seq_no), 0) + 1 into new.seq_no
  from public.pm_projects where org_id = new.org_id;

  new.project_number := 'PRJ-' || lpad(new.seq_no::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists pm_projects_assign_number on public.pm_projects;
create trigger pm_projects_assign_number
  before insert on public.pm_projects
  for each row execute function private.pm_assign_project_number();

-- Lifecycle timestamps the client should not have to remember. Only ever set —
-- never cleared — so a project that briefly re-opens keeps its original dates.
create or replace function private.pm_stamp_project_lifecycle()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.phase is distinct from old.phase then
    if new.phase in ('mitigation', 'production', 'drying') and new.started_at is null then
      new.started_at := pg_catalog.now();
    end if;
    if new.phase in ('final_review', 'invoicing', 'paid') and new.completed_at is null then
      new.completed_at := pg_catalog.now();
    end if;
  end if;

  if new.status is distinct from old.status
     and new.status in ('closed', 'cancelled')
     and new.closed_at is null then
    new.closed_at := pg_catalog.now();
  end if;

  return new;
end;
$$;

drop trigger if exists pm_projects_stamp_lifecycle on public.pm_projects;
create trigger pm_projects_stamp_lifecycle
  before update on public.pm_projects
  for each row execute function private.pm_stamp_project_lifecycle();

drop trigger if exists pm_projects_touch on public.pm_projects;
create trigger pm_projects_touch
  before update on public.pm_projects
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Tasks
-- ----------------------------------------------------------------------------
-- `origin_key` is what makes generated work idempotent. The playbook re-runs
-- every time the engine wakes up; without a stable key per (project, template)
-- it would re-create "Take daily moisture readings" on every pass. With it, the
-- second attempt is a no-op the database enforces.

create table if not exists public.pm_tasks (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id),
  project_id   uuid not null references public.pm_projects(id),

  title        text not null check (length(btrim(title)) between 2 and 200),
  details      text check (details is null or length(details) <= 4000),

  status       text not null default 'todo'
                 check (status in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority     text not null default 'normal'
                 check (priority in ('low', 'normal', 'high', 'urgent')),
  category     text not null default 'general'
                 check (category in ('general', 'documentation', 'drying', 'equipment',
                                     'scheduling', 'customer', 'insurance', 'inspection', 'billing')),

  assigned_to  uuid references auth.users(id),
  due_at       timestamptz,
  position     integer not null default 0,

  -- Where this task came from. 'playbook' is the phase template, 'agent' is the
  -- automation reacting to something specific. Both are visibly not-a-human so a
  -- PM can tell what they were handed versus what they wrote.
  source       text not null default 'manual'
                 check (source in ('manual', 'playbook', 'agent')),
  origin_key   text check (origin_key is null or length(origin_key) <= 120),
  agent_run_id uuid,

  blocked_reason text check (blocked_reason is null or length(blocked_reason) <= 500),
  completed_at   timestamptz,
  completed_by   uuid references auth.users(id),

  created_by   uuid not null default auth.uid() references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.pm_tasks is
  'A unit of work under a project. Generated tasks carry a stable origin_key so '
  'regenerating a playbook cannot duplicate them.';

create unique index if not exists pm_tasks_origin_unique
  on public.pm_tasks (project_id, origin_key)
  where origin_key is not null;

create index if not exists pm_tasks_project_idx  on public.pm_tasks (project_id, position, created_at);
create index if not exists pm_tasks_assignee_idx on public.pm_tasks (org_id, assigned_to, status);
create index if not exists pm_tasks_due_idx      on public.pm_tasks (org_id, due_at)
  where status in ('todo', 'in_progress', 'blocked');

create or replace function private.pm_stamp_task_completion()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'done' and new.completed_at is null then
      new.completed_at := pg_catalog.now();
      new.completed_by := auth.uid();
    elsif new.status <> 'done' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;

  -- 'blocked' without a reason is the state that silently eats a schedule.
  if new.status = 'blocked' and coalesce(btrim(new.blocked_reason), '') = '' then
    raise exception 'a blocked task needs a reason' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists pm_tasks_stamp_completion on public.pm_tasks;
create trigger pm_tasks_stamp_completion
  before update on public.pm_tasks
  for each row execute function private.pm_stamp_task_completion();

drop trigger if exists pm_tasks_touch on public.pm_tasks;
create trigger pm_tasks_touch
  before update on public.pm_tasks
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Crew assignments
-- ----------------------------------------------------------------------------
-- Released, never deleted: "who was on this job in week two" is a question that
-- gets asked months later, usually by someone disputing an invoice.

create table if not exists public.pm_assignments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id),
  project_id     uuid not null references public.pm_projects(id),
  user_id        uuid not null references auth.users(id),

  role_on_project text not null default 'crew'
                    check (role_on_project in ('lead', 'crew', 'estimator', 'supervisor', 'observer')),
  -- Planned share of this person's day, so the capacity rule has something to
  -- add up. 100 = all day.
  allocation_pct  integer not null default 100
                    check (allocation_pct between 1 and 100),

  assigned_by    uuid not null default auth.uid() references auth.users(id),
  assigned_at    timestamptz not null default now(),
  released_at    timestamptz,
  updated_at     timestamptz not null default now()
);

comment on table public.pm_assignments is
  'Who is on a project, and was. Released rather than deleted.';

create unique index if not exists pm_assignments_active_unique
  on public.pm_assignments (project_id, user_id)
  where released_at is null;

create index if not exists pm_assignments_user_idx
  on public.pm_assignments (org_id, user_id, assigned_at desc);

drop trigger if exists pm_assignments_touch on public.pm_assignments;
create trigger pm_assignments_touch
  before update on public.pm_assignments
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Equipment
-- ----------------------------------------------------------------------------
-- Equipment left on a dried-out job is the most common quiet loss in mitigation:
-- it is not billable after the dry-out is signed off, and it is not on the next
-- job either. Modelling placements with an explicit `removed_at` is what lets a
-- rule notice.

create table if not exists public.pm_equipment (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id),

  asset_tag   text not null check (length(btrim(asset_tag)) between 1 and 40),
  kind        text not null
                check (kind in ('dehumidifier', 'air_mover', 'air_scrubber', 'heater',
                                'hydroxyl', 'ozone', 'generator', 'other')),
  make_model  text,
  -- LGR dehus are rated in pints/day at AHAM; air movers in CFM. One nullable
  -- column each beats a jsonb bag we would have to guess the shape of later.
  capacity_pints_day integer check (capacity_pints_day is null or capacity_pints_day > 0),
  capacity_cfm       integer check (capacity_cfm is null or capacity_cfm > 0),

  status      text not null default 'available'
                check (status in ('available', 'deployed', 'maintenance', 'retired')),
  daily_rate_cents integer check (daily_rate_cents is null or daily_rate_cents >= 0),

  created_by  uuid not null default auth.uid() references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint pm_equipment_tag_unique unique (org_id, asset_tag)
);

comment on table public.pm_equipment is 'An organization''s equipment inventory. Retired, never deleted.';

create index if not exists pm_equipment_status_idx on public.pm_equipment (org_id, status, kind);

drop trigger if exists pm_equipment_touch on public.pm_equipment;
create trigger pm_equipment_touch
  before update on public.pm_equipment
  for each row execute function private.touch_updated_at();

create table if not exists public.pm_equipment_placements (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id),
  project_id   uuid not null references public.pm_projects(id),
  equipment_id uuid not null references public.pm_equipment(id),

  area_label   text check (area_label is null or length(area_label) <= 120),
  placed_at    timestamptz not null default now(),
  removed_at   timestamptz,
  -- Snapshot of the rate at placement time, so re-pricing the inventory later
  -- cannot retroactively change what a finished job was worth.
  billed_rate_cents integer check (billed_rate_cents is null or billed_rate_cents >= 0),

  placed_by    uuid not null default auth.uid() references auth.users(id),
  removed_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint pm_placement_dates_sane check (removed_at is null or removed_at >= placed_at)
);

comment on table public.pm_equipment_placements is
  'A piece of equipment on a project between placed_at and removed_at. Equipment-days bill from this.';

-- A given asset can only be on one job at a time.
create unique index if not exists pm_placements_active_unique
  on public.pm_equipment_placements (equipment_id)
  where removed_at is null;

create index if not exists pm_placements_project_idx
  on public.pm_equipment_placements (project_id, placed_at desc);
create index if not exists pm_placements_open_idx
  on public.pm_equipment_placements (org_id, placed_at)
  where removed_at is null;

drop trigger if exists pm_placements_touch on public.pm_equipment_placements;
create trigger pm_placements_touch
  before update on public.pm_equipment_placements
  for each row execute function private.touch_updated_at();

-- Keeps `pm_equipment.status` in step with reality instead of asking the client
-- to remember two writes. Maintenance and retirement are set by hand and are
-- deliberately left alone here.
create or replace function private.pm_sync_equipment_status()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if tg_op = 'INSERT' or (new.removed_at is null and old.removed_at is not null) then
    update public.pm_equipment
       set status = 'deployed'
     where id = new.equipment_id and status = 'available';
  elsif tg_op = 'UPDATE' and new.removed_at is not null and old.removed_at is null then
    update public.pm_equipment
       set status = 'available'
     where id = new.equipment_id and status = 'deployed';
  end if;
  return null;
end;
$$;

drop trigger if exists pm_placements_sync_equipment on public.pm_equipment_placements;
create trigger pm_placements_sync_equipment
  after insert or update of removed_at on public.pm_equipment_placements
  for each row execute function private.pm_sync_equipment_status();

-- ----------------------------------------------------------------------------
-- 5. Drying — areas and readings
-- ----------------------------------------------------------------------------
-- IICRC S500 wants a documented dry standard per material and a daily reading
-- against it. That is the paperwork adjusters actually audit, and it is also
-- exactly the shape a rule needs: a goal, a series, and a timestamp.

create table if not exists public.pm_drying_areas (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id),
  project_id     uuid not null references public.pm_projects(id),

  label          text not null check (length(btrim(label)) between 1 and 120),
  material       text not null default 'drywall'
                   check (material in ('drywall', 'wood', 'engineered_wood', 'concrete',
                                       'plaster', 'carpet', 'subfloor', 'insulation', 'other')),

  -- The dry standard for this material, normally taken from an unaffected
  -- control reading in the same structure. `dry_goal_pct` is what "dry" means
  -- here; without it a reading is a number with no verdict attached.
  dry_goal_pct   numeric(5,2) not null check (dry_goal_pct > 0 and dry_goal_pct <= 100),
  -- Water class drives how much airflow and dehumidification the area needs.
  water_class    integer check (water_class between 1 and 4),
  affected_sqft  numeric(10,2) check (affected_sqft is null or affected_sqft >= 0),
  affected_cuft  numeric(12,2) check (affected_cuft is null or affected_cuft >= 0),

  established_at timestamptz not null default now(),
  dried_at       timestamptz,
  -- A PM signs off that the area met its goal. Distinct from `dried_at`, which
  -- the readings establish: the machine's opinion and the human's are both worth
  -- keeping, and when they differ that is itself the interesting thing.
  signed_off_at  timestamptz,
  signed_off_by  uuid references auth.users(id),

  created_by     uuid not null default auth.uid() references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.pm_drying_areas is
  'A drying area with a documented dry standard. The unit a drying rule reasons about.';

create index if not exists pm_drying_areas_project_idx on public.pm_drying_areas (project_id, created_at);
create index if not exists pm_drying_areas_open_idx    on public.pm_drying_areas (org_id, project_id)
  where dried_at is null;

drop trigger if exists pm_drying_areas_touch on public.pm_drying_areas;
create trigger pm_drying_areas_touch
  before update on public.pm_drying_areas
  for each row execute function private.touch_updated_at();

-- Readings are evidence. There is no UPDATE and no DELETE policy on this table:
-- a moisture log you can quietly revise is not a moisture log, and it is the
-- first thing a carrier's auditor stops trusting. A mistaken reading is
-- superseded by the next one, and `note` is where the correction goes.
create table if not exists public.pm_moisture_readings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id),
  project_id    uuid not null references public.pm_projects(id),
  area_id       uuid references public.pm_drying_areas(id),

  kind          text not null default 'affected'
                  check (kind in ('affected', 'control', 'ambient', 'outside', 'dehu_outlet')),
  -- Moisture content / WME of a material. Null for the ambient-only readings
  -- (outside air, dehu outlet) that carry temperature and RH but no material.
  moisture_pct  numeric(5,2) check (moisture_pct is null or (moisture_pct >= 0 and moisture_pct <= 100)),
  temperature_f numeric(5,2) check (temperature_f is null or (temperature_f > -40 and temperature_f < 200)),
  humidity_pct  numeric(5,2) check (humidity_pct is null or (humidity_pct >= 0 and humidity_pct <= 100)),
  -- Grains per pound. Derived from temperature + RH when not supplied; stored
  -- because drying progress is a falling GPP and recomputing it on every read of
  -- a long log is wasted work.
  gpp           numeric(6,2) check (gpp is null or gpp >= 0),

  -- A reading has to be *something*: either a material moisture content or an
  -- air condition. A row with neither is a timestamp pretending to be data.
  constraint pm_reading_has_a_value check (
    moisture_pct is not null or (temperature_f is not null and humidity_pct is not null)
  ),

  note          text check (note is null or length(note) <= 2000),
  taken_at      timestamptz not null default now(),
  taken_by      uuid not null default auth.uid() references auth.users(id),
  created_at    timestamptz not null default now()
);

comment on table public.pm_moisture_readings is
  'Append-only moisture and psychrometric log. No UPDATE or DELETE policy, by design.';

create index if not exists pm_readings_area_idx    on public.pm_moisture_readings (area_id, taken_at desc);
create index if not exists pm_readings_project_idx on public.pm_moisture_readings (project_id, taken_at desc);
create index if not exists pm_readings_org_day_idx on public.pm_moisture_readings (org_id, taken_at desc);

-- ----------------------------------------------------------------------------
-- 6. Documentation and insurance milestones
-- ----------------------------------------------------------------------------
-- The requirement *catalogue* lives in code (backend/src/pm/requirements.ts);
-- this table holds one row per requirement instance per project, which is what
-- turns "is this job billable yet?" from a conversation into a query.

create table if not exists public.pm_documents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.pm_projects(id),

  -- Stable key from the requirement catalogue, e.g. 'authorization_to_perform'.
  requirement_key text not null check (length(btrim(requirement_key)) between 2 and 80),
  label           text not null check (length(btrim(label)) between 2 and 160),
  kind            text not null default 'form'
                    check (kind in ('photo', 'form', 'signature', 'report', 'estimate',
                                    'invoice', 'reading_log', 'certificate', 'other')),

  status          text not null default 'missing'
                    check (status in ('missing', 'provided', 'waived', 'rejected')),
  -- Where the artifact actually lives. Storage buckets are a separate design
  -- problem, so this is a reference (URL or external system id), not a blob.
  external_ref    text check (external_ref is null or length(external_ref) <= 2000),
  note            text check (note is null or length(note) <= 2000),

  -- Blocking requirements are the ones that stop an invoice. Non-blocking ones
  -- are nice-to-have and must never hold up billing.
  is_blocking     boolean not null default true,
  required_by_phase text,

  provided_at     timestamptz,
  provided_by     uuid references auth.users(id),
  waived_reason   text check (waived_reason is null or length(waived_reason) <= 500),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint pm_documents_requirement_unique unique (project_id, requirement_key)
);

comment on table public.pm_documents is
  'One row per documentation requirement per project. Drives the invoice-readiness check.';

create index if not exists pm_documents_project_idx on public.pm_documents (project_id, status);
create index if not exists pm_documents_open_idx    on public.pm_documents (org_id, project_id)
  where status = 'missing';

create or replace function private.pm_stamp_document()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'provided' and new.provided_at is null then
      new.provided_at := pg_catalog.now();
      new.provided_by := auth.uid();
    elsif new.status = 'missing' then
      new.provided_at := null;
      new.provided_by := null;
    end if;
  end if;

  if new.status = 'waived' and coalesce(btrim(new.waived_reason), '') = '' then
    raise exception 'waiving a requirement needs a reason' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists pm_documents_stamp on public.pm_documents;
create trigger pm_documents_stamp
  before update on public.pm_documents
  for each row execute function private.pm_stamp_document();

drop trigger if exists pm_documents_touch on public.pm_documents;
create trigger pm_documents_touch
  before update on public.pm_documents
  for each row execute function private.touch_updated_at();

-- Deadline-bearing commitments: carrier reporting windows, permit inspections,
-- the customer walkthrough. Separate from tasks because a milestone is a date
-- someone else is holding us to, and missing one has a consequence a to-do does not.
create table if not exists public.pm_milestones (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id),
  project_id     uuid not null references public.pm_projects(id),

  milestone_key  text check (milestone_key is null or length(milestone_key) <= 80),
  label          text not null check (length(btrim(label)) between 2 and 160),
  kind           text not null default 'carrier'
                   check (kind in ('carrier', 'permit', 'customer', 'internal', 'billing')),

  due_at         timestamptz not null,
  completed_at   timestamptz,
  completed_by   uuid references auth.users(id),
  note           text check (note is null or length(note) <= 2000),

  created_by     uuid not null default auth.uid() references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint pm_milestones_key_unique unique (project_id, milestone_key)
);

comment on table public.pm_milestones is
  'A dated commitment to someone outside the crew. Drives deadline alerts.';

create index if not exists pm_milestones_due_idx on public.pm_milestones (org_id, due_at)
  where completed_at is null;
create index if not exists pm_milestones_project_idx on public.pm_milestones (project_id, due_at);

drop trigger if exists pm_milestones_touch on public.pm_milestones;
create trigger pm_milestones_touch
  before update on public.pm_milestones
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Alerts — what the agent found
-- ----------------------------------------------------------------------------
-- The engine is stateless and re-derives every finding from scratch on each run.
-- `fingerprint` is what makes that safe: it identifies *this* problem on *this*
-- entity, so a re-run updates the existing row instead of adding another copy,
-- and a finding that has gone away can be resolved automatically.
--
-- Without it, an automation that runs every fifteen minutes becomes a machine
-- for generating noise, and a PM learns to ignore the whole panel.

create table if not exists public.pm_alerts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id),
  project_id    uuid references public.pm_projects(id),

  rule_key      text not null check (length(btrim(rule_key)) between 2 and 80),
  fingerprint   text not null check (length(btrim(fingerprint)) between 2 and 400),
  severity      text not null default 'warn' check (severity in ('info', 'warn', 'critical')),
  category      text not null default 'general'
                  check (category in ('general', 'drying', 'equipment', 'scheduling',
                                      'documentation', 'insurance', 'billing', 'customer')),

  title         text not null check (length(btrim(title)) between 2 and 200),
  detail        text check (detail is null or length(detail) <= 4000),
  -- What to do about it, and a deep link target. The value of an alert is
  -- mostly in this column: "3 areas have no reading today" is an observation,
  -- "take readings in Kitchen, Hall, Bath 2" is work.
  suggested_action text check (suggested_action is null or length(suggested_action) <= 1000),
  entity_type   text check (entity_type is null or length(entity_type) <= 40),
  entity_id     uuid,
  facts         jsonb not null default '{}'::jsonb,

  status        text not null default 'open'
                  check (status in ('open', 'acknowledged', 'snoozed', 'resolved', 'dismissed')),
  -- 'cleared' means the engine found the condition gone; anything else was a
  -- human. Keeping them apart is how you tell a fixed problem from an ignored one.
  resolution    text check (resolution is null or resolution in ('cleared', 'handled', 'dismissed', 'expired')),
  snooze_until  timestamptz,

  occurrences   integer not null default 1 check (occurrences >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users(id),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users(id),

  agent_run_id  uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint pm_alerts_fingerprint_unique unique (org_id, fingerprint)
);

comment on table public.pm_alerts is
  'A finding from the automation engine, deduplicated by fingerprint so repeated '
  'runs update one row instead of piling up copies.';

create index if not exists pm_alerts_open_idx on public.pm_alerts (org_id, severity, last_seen_at desc)
  where status in ('open', 'acknowledged', 'snoozed');
create index if not exists pm_alerts_project_idx on public.pm_alerts (project_id, status);
create index if not exists pm_alerts_rule_idx    on public.pm_alerts (org_id, rule_key, status);

drop trigger if exists pm_alerts_touch on public.pm_alerts;
create trigger pm_alerts_touch
  before update on public.pm_alerts
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 8. Briefs and drafted updates
-- ----------------------------------------------------------------------------

create table if not exists public.pm_briefs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id),
  -- Whose brief. Briefs are per-PM because the whole point is "your morning",
  -- not "the company's morning".
  user_id      uuid not null default auth.uid() references auth.users(id),

  for_date     date not null,
  kind         text not null default 'morning' check (kind in ('morning', 'end_of_day', 'ad_hoc')),
  -- The deterministic facts the brief was built from, kept so a brief can be
  -- re-read later without re-running anything, and so a wrong brief can be
  -- checked against what the engine actually knew at the time.
  facts        jsonb not null default '{}'::jsonb,
  headline     text check (headline is null or length(headline) <= 300),
  body         text not null check (length(btrim(body)) between 1 and 20000),

  -- Null when the brief was assembled without a model (the deterministic
  -- fallback), which is also what happens when no API key is configured.
  model_id     text,
  agent_run_id uuid,
  created_at   timestamptz not null default now(),

  constraint pm_briefs_one_per_day unique (org_id, user_id, for_date, kind)
);

comment on table public.pm_briefs is 'A PM''s generated brief for a day. One per user per kind per day.';

create index if not exists pm_briefs_user_idx on public.pm_briefs (org_id, user_id, for_date desc);

-- Drafted outbound text. The agent writes; a human sends. `sent_at` is only ever
-- set by a person marking it sent, and nothing in this codebase delivers email
-- or SMS — see docs/project-manager-agent.md §Guardrails.
create table if not exists public.pm_updates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id),
  project_id   uuid not null references public.pm_projects(id),

  audience     text not null check (audience in ('customer', 'adjuster', 'team')),
  channel      text not null default 'email' check (channel in ('email', 'sms', 'call', 'note')),
  status       text not null default 'draft'
                 check (status in ('draft', 'approved', 'sent', 'discarded')),

  subject      text check (subject is null or length(subject) <= 300),
  body         text not null check (length(btrim(body)) between 1 and 8000),

  origin       text not null default 'agent' check (origin in ('agent', 'manual')),
  model_id     text,
  agent_run_id uuid,

  created_by   uuid not null default auth.uid() references auth.users(id),
  approved_by  uuid references auth.users(id),
  approved_at  timestamptz,
  sent_at      timestamptz,
  sent_by      uuid references auth.users(id),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.pm_updates is
  'A drafted message to a customer, adjuster or the crew. Nothing here is delivered '
  'by the system — a human approves and sends.';

create index if not exists pm_updates_project_idx on public.pm_updates (project_id, created_at desc);
create index if not exists pm_updates_open_idx    on public.pm_updates (org_id, status, created_at desc);

create or replace function private.pm_stamp_update()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' and new.approved_at is null then
      new.approved_at := pg_catalog.now();
      new.approved_by := auth.uid();
    elsif new.status = 'sent' and new.sent_at is null then
      new.sent_at := pg_catalog.now();
      new.sent_by := auth.uid();
    end if;
  end if;

  -- The body is the thing a human reviewed. Editing it after approval would
  -- make the approval meaningless, so re-approval is required.
  if new.status in ('approved', 'sent')
     and old.status in ('approved', 'sent')
     and new.body is distinct from old.body then
    raise exception 'an approved update cannot be rewritten — draft a new one'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists pm_updates_stamp on public.pm_updates;
create trigger pm_updates_stamp
  before update on public.pm_updates
  for each row execute function private.pm_stamp_update();

drop trigger if exists pm_updates_touch on public.pm_updates;
create trigger pm_updates_touch
  before update on public.pm_updates
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 9. Automation settings
-- ----------------------------------------------------------------------------
-- Thresholds live in the database rather than in code because they are the
-- knobs a shop actually argues about — how many hours late is late, how many
-- days without progress is stalled — and changing one should not need a deploy.

create table if not exists public.pm_automation_settings (
  org_id        uuid primary key references public.orgs(id),

  enabled       boolean not null default true,
  -- IANA zone. "Did anyone take a reading today?" is meaningless without it.
  timezone      text not null default 'America/New_York',
  digest_hour   integer not null default 7 check (digest_hour between 0 and 23),

  -- Hours since the last reading in an open drying area before it is late.
  reading_interval_hours    integer not null default 24 check (reading_interval_hours between 4 and 168),
  -- Consecutive days of no meaningful moisture drop before a dry-out is stalled.
  drying_stall_days         integer not null default 2 check (drying_stall_days between 1 and 14),
  -- Moisture-point drop below which a day counts as "no progress".
  drying_progress_min_pct   numeric(4,2) not null default 1.0
                              check (drying_progress_min_pct >= 0 and drying_progress_min_pct <= 20),
  -- Grace period after an area meets its goal before parked equipment is flagged.
  equipment_idle_hours      integer not null default 24 check (equipment_idle_hours between 1 and 336),
  -- Days a project can sit with no logged activity before it is stale.
  stale_project_days        integer not null default 3 check (stale_project_days between 1 and 60),
  -- How far ahead a milestone starts warning.
  milestone_lead_days       integer not null default 3 check (milestone_lead_days between 0 and 30),
  -- Concurrent active projects per crew member before the load is called over.
  max_projects_per_crew     integer not null default 4 check (max_projects_per_crew between 1 and 50),

  -- Rules the org has switched off, by rule_key. An empty array means all on.
  disabled_rules text[] not null default '{}',
  -- Whether the engine may create playbook tasks on its own, as opposed to only
  -- reporting that they are missing.
  auto_create_tasks boolean not null default true,

  updated_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.pm_automation_settings is
  'Per-org automation thresholds. One row per org, created on first read.';

drop trigger if exists pm_automation_settings_touch on public.pm_automation_settings;
create trigger pm_automation_settings_touch
  before update on public.pm_automation_settings
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 9b. org_id is derived, never trusted
-- ----------------------------------------------------------------------------
-- Every child table's `org_id` is forced to its project's `org_id` on insert.
-- Two reasons, and the second is the important one:
--
--   1. Callers do not have to pass it, and cannot get it wrong.
--   2. A caller cannot *lie* about it. The RLS check on `org_id` runs after
--      BEFORE triggers, so overwriting the column here means an attacker who
--      knows a project id in another org still ends up checked against that
--      other org's membership — which they do not have. Had we merely defaulted
--      the column, a supplied value would have survived.

create or replace function private.pm_fill_org_from_project()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_org uuid;
begin
  if new.project_id is null then
    return new;  -- org-level row (an alert with no project); org_id stands as given.
  end if;

  select p.org_id into v_org from public.pm_projects p where p.id = new.project_id;

  if v_org is null then
    raise exception 'project % does not exist', new.project_id using errcode = '23503';
  end if;

  new.org_id := v_org;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'pm_tasks', 'pm_assignments', 'pm_equipment_placements', 'pm_drying_areas',
    'pm_moisture_readings', 'pm_documents', 'pm_milestones', 'pm_alerts', 'pm_updates'
  ]
  loop
    execute format('drop trigger if exists pm_fill_org on public.%I', t);
    execute format(
      'create trigger pm_fill_org before insert on public.%I '
      'for each row execute function private.pm_fill_org_from_project()', t);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Row Level Security
-- ----------------------------------------------------------------------------
-- Reads: any member of the org. The README's promise is that everyone linked to
-- an org can see and work together, and a PM's data is not secret from the crew
-- doing the work.
--
-- Writes split two ways:
--   * Planning (projects, assignments, milestones, inventory, settings) is
--     limited to `private.pm_can_manage` — project managers, office managers,
--     and the org's creator.
--   * Reporting (readings, placements, drying areas, documents, tasks you own)
--     is open to any member, because the person holding the meter is a
--     technician and blocking them would push the data back onto paper.
--
-- No table has a DELETE policy. Everything here is either superseded or
-- cancelled in place.

alter table public.pm_projects            enable row level security;
alter table public.pm_tasks               enable row level security;
alter table public.pm_assignments         enable row level security;
alter table public.pm_equipment           enable row level security;
alter table public.pm_equipment_placements enable row level security;
alter table public.pm_drying_areas        enable row level security;
alter table public.pm_moisture_readings   enable row level security;
alter table public.pm_documents           enable row level security;
alter table public.pm_milestones          enable row level security;
alter table public.pm_alerts              enable row level security;
alter table public.pm_briefs              enable row level security;
alter table public.pm_updates             enable row level security;
alter table public.pm_automation_settings enable row level security;

-- Projects -------------------------------------------------------------------
drop policy if exists pm_projects_select on public.pm_projects;
create policy pm_projects_select on public.pm_projects
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_projects_insert on public.pm_projects;
create policy pm_projects_insert on public.pm_projects
  for insert to authenticated with check (private.pm_can_manage(org_id));

drop policy if exists pm_projects_update on public.pm_projects;
create policy pm_projects_update on public.pm_projects
  for update to authenticated
  using (private.pm_can_manage(org_id))
  with check (private.pm_can_manage(org_id));

-- Tasks ----------------------------------------------------------------------
drop policy if exists pm_tasks_select on public.pm_tasks;
create policy pm_tasks_select on public.pm_tasks
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_tasks_insert on public.pm_tasks;
create policy pm_tasks_insert on public.pm_tasks
  for insert to authenticated
  with check (
    private.pm_can_manage(org_id)
    and private.pm_project_in_org(project_id, org_id)
  );

-- A technician may work their own task through to done, which is the whole
-- point of assigning it, but only a manager can re-title it or hand it to
-- somebody else. That distinction is enforced in the route layer
-- (backend/src/pm/store.ts) because a policy cannot see which columns changed
-- without a trigger, and the trigger below is the belt to that braces.
drop policy if exists pm_tasks_update on public.pm_tasks;
create policy pm_tasks_update on public.pm_tasks
  for update to authenticated
  using (private.pm_can_manage(org_id) or assigned_to = auth.uid())
  with check (private.pm_can_manage(org_id) or assigned_to = auth.uid());

-- Stops an assignee from quietly reassigning or re-scoping a task they were
-- only given permission to *do*. Managers are unaffected.
create or replace function private.pm_guard_task_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if private.pm_can_manage(new.org_id) then
    return new;
  end if;

  if new.project_id is distinct from old.project_id
     or new.assigned_to is distinct from old.assigned_to
     or new.title      is distinct from old.title
     or new.due_at     is distinct from old.due_at
     or new.priority   is distinct from old.priority
     or new.origin_key is distinct from old.origin_key
     or new.source     is distinct from old.source then
    raise exception 'only a project manager can reassign or re-scope a task'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists pm_tasks_guard_update on public.pm_tasks;
create trigger pm_tasks_guard_update
  before update on public.pm_tasks
  for each row execute function private.pm_guard_task_update();

-- Assignments ----------------------------------------------------------------
drop policy if exists pm_assignments_select on public.pm_assignments;
create policy pm_assignments_select on public.pm_assignments
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_assignments_insert on public.pm_assignments;
create policy pm_assignments_insert on public.pm_assignments
  for insert to authenticated
  with check (
    private.pm_can_manage(org_id)
    and private.pm_project_in_org(project_id, org_id)
    -- You can only put your own org's people on your own org's jobs.
    and private.is_org_member(org_id)
    and exists (
      select 1 from public.org_members om
      where om.org_id = pm_assignments.org_id and om.user_id = pm_assignments.user_id
    )
  );

drop policy if exists pm_assignments_update on public.pm_assignments;
create policy pm_assignments_update on public.pm_assignments
  for update to authenticated
  using (private.pm_can_manage(org_id))
  with check (private.pm_can_manage(org_id));

-- Equipment ------------------------------------------------------------------
drop policy if exists pm_equipment_select on public.pm_equipment;
create policy pm_equipment_select on public.pm_equipment
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_equipment_insert on public.pm_equipment;
create policy pm_equipment_insert on public.pm_equipment
  for insert to authenticated with check (private.pm_can_manage(org_id));

drop policy if exists pm_equipment_update on public.pm_equipment;
create policy pm_equipment_update on public.pm_equipment
  for update to authenticated
  using (private.pm_can_manage(org_id))
  with check (private.pm_can_manage(org_id));

-- Placements: any member, because the technician on site is the one who sets a
-- dehu down and picks it back up.
drop policy if exists pm_placements_select on public.pm_equipment_placements;
create policy pm_placements_select on public.pm_equipment_placements
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_placements_insert on public.pm_equipment_placements;
create policy pm_placements_insert on public.pm_equipment_placements
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and private.pm_project_in_org(project_id, org_id)
    and exists (
      select 1 from public.pm_equipment e
      where e.id = pm_equipment_placements.equipment_id
        and e.org_id = pm_equipment_placements.org_id
        and e.status <> 'retired'
    )
  );

drop policy if exists pm_placements_update on public.pm_equipment_placements;
create policy pm_placements_update on public.pm_equipment_placements
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- Drying areas and readings --------------------------------------------------
drop policy if exists pm_drying_areas_select on public.pm_drying_areas;
create policy pm_drying_areas_select on public.pm_drying_areas
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_drying_areas_insert on public.pm_drying_areas;
create policy pm_drying_areas_insert on public.pm_drying_areas
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and private.pm_project_in_org(project_id, org_id)
  );

drop policy if exists pm_drying_areas_update on public.pm_drying_areas;
create policy pm_drying_areas_update on public.pm_drying_areas
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- INSERT only. See the table comment: this log is evidence.
drop policy if exists pm_readings_select on public.pm_moisture_readings;
create policy pm_readings_select on public.pm_moisture_readings
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_readings_insert on public.pm_moisture_readings;
create policy pm_readings_insert on public.pm_moisture_readings
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and private.pm_project_in_org(project_id, org_id)
    and (
      area_id is null
      or exists (
        select 1 from public.pm_drying_areas a
        where a.id = pm_moisture_readings.area_id
          and a.project_id = pm_moisture_readings.project_id
      )
    )
  );

-- Documents and milestones ---------------------------------------------------
drop policy if exists pm_documents_select on public.pm_documents;
create policy pm_documents_select on public.pm_documents
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_documents_insert on public.pm_documents;
create policy pm_documents_insert on public.pm_documents
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and private.pm_project_in_org(project_id, org_id)
  );

drop policy if exists pm_documents_update on public.pm_documents;
create policy pm_documents_update on public.pm_documents
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- Waiving a blocking requirement is a billing decision, not a field one.
create or replace function private.pm_guard_document_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if new.status = 'waived'
     and old.status is distinct from 'waived'
     and not private.pm_can_manage(new.org_id) then
    raise exception 'only a project manager can waive a documentation requirement'
      using errcode = '42501';
  end if;

  if (new.is_blocking is distinct from old.is_blocking
      or new.requirement_key is distinct from old.requirement_key)
     and not private.pm_can_manage(new.org_id) then
    raise exception 'only a project manager can change what a requirement is'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists pm_documents_guard on public.pm_documents;
create trigger pm_documents_guard
  before update on public.pm_documents
  for each row execute function private.pm_guard_document_update();

drop policy if exists pm_milestones_select on public.pm_milestones;
create policy pm_milestones_select on public.pm_milestones
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_milestones_insert on public.pm_milestones;
create policy pm_milestones_insert on public.pm_milestones
  for insert to authenticated
  with check (
    private.pm_can_manage(org_id)
    and private.pm_project_in_org(project_id, org_id)
  );

drop policy if exists pm_milestones_update on public.pm_milestones;
create policy pm_milestones_update on public.pm_milestones
  for update to authenticated
  using (private.pm_can_manage(org_id))
  with check (private.pm_can_manage(org_id));

-- Alerts ---------------------------------------------------------------------
-- Insert is open to any member because the engine runs under whoever's session
-- triggered it, including a technician opening the app. Reconciliation is
-- idempotent, so that is safe.
drop policy if exists pm_alerts_select on public.pm_alerts;
create policy pm_alerts_select on public.pm_alerts
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_alerts_insert on public.pm_alerts;
create policy pm_alerts_insert on public.pm_alerts
  for insert to authenticated with check (private.is_org_member(org_id));

drop policy if exists pm_alerts_update on public.pm_alerts;
create policy pm_alerts_update on public.pm_alerts
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- An alert's identity is fixed once written. Without this, "resolved" could be
-- achieved by rewriting the finding into something harmless.
create or replace function private.pm_guard_alert_update()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if new.org_id is distinct from old.org_id
     or new.rule_key is distinct from old.rule_key
     or new.fingerprint is distinct from old.fingerprint
     or new.project_id is distinct from old.project_id
     or new.first_seen_at is distinct from old.first_seen_at
     or new.created_at is distinct from old.created_at then
    raise exception 'pm_alerts: identity columns are immutable'
      using errcode = 'restrict_violation';
  end if;

  if new.occurrences < old.occurrences then
    raise exception 'pm_alerts: occurrences cannot decrease'
      using errcode = 'restrict_violation';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'acknowledged' and new.acknowledged_at is null then
      new.acknowledged_at := pg_catalog.now();
      new.acknowledged_by := auth.uid();
    elsif new.status in ('resolved', 'dismissed') and new.resolved_at is null then
      new.resolved_at := pg_catalog.now();
      -- Left null when the engine cleared it: auth.uid() is the session that
      -- happened to run the engine, not somebody who decided anything.
      new.resolved_by := case when new.resolution = 'cleared' then null else auth.uid() end;
    elsif new.status = 'open' then
      new.resolved_at := null;
      new.resolved_by := null;
      new.resolution  := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists pm_alerts_guard on public.pm_alerts;
create trigger pm_alerts_guard
  before update on public.pm_alerts
  for each row execute function private.pm_guard_alert_update();

-- Briefs ---------------------------------------------------------------------
-- Readable org-wide (a PM covering for another needs to see their morning), but
-- you may only write your own.
drop policy if exists pm_briefs_select on public.pm_briefs;
create policy pm_briefs_select on public.pm_briefs
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_briefs_insert on public.pm_briefs;
create policy pm_briefs_insert on public.pm_briefs
  for insert to authenticated
  with check (private.is_org_member(org_id) and user_id = auth.uid());

-- Updates --------------------------------------------------------------------
drop policy if exists pm_updates_select on public.pm_updates;
create policy pm_updates_select on public.pm_updates
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists pm_updates_insert on public.pm_updates;
create policy pm_updates_insert on public.pm_updates
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and private.pm_project_in_org(project_id, org_id)
    -- Drafts only. Nothing gets to be born approved.
    and status = 'draft'
  );

drop policy if exists pm_updates_update on public.pm_updates;
create policy pm_updates_update on public.pm_updates
  for update to authenticated
  using (private.pm_can_manage(org_id))
  with check (private.pm_can_manage(org_id));

-- Settings -------------------------------------------------------------------
drop policy if exists pm_settings_select on public.pm_automation_settings;
create policy pm_settings_select on public.pm_automation_settings
  for select to authenticated using (private.is_org_member(org_id));

-- Insert is open to any member so the first read can create the defaults row
-- without a technician hitting a permission error. The row is all defaults;
-- changing a threshold still needs a manager.
drop policy if exists pm_settings_insert on public.pm_automation_settings;
create policy pm_settings_insert on public.pm_automation_settings
  for insert to authenticated with check (private.is_org_member(org_id));

drop policy if exists pm_settings_update on public.pm_automation_settings;
create policy pm_settings_update on public.pm_automation_settings
  for update to authenticated
  using (private.pm_can_manage(org_id))
  with check (private.pm_can_manage(org_id));

-- ----------------------------------------------------------------------------
-- 11. Grants
-- ----------------------------------------------------------------------------
-- This project's default privileges hand every new table in `public` to `anon`
-- as well as `authenticated`, so the revoke below is not belt-and-braces — it is
-- the grant that would otherwise be there. The policies above are all `to
-- authenticated`, so anon was already refused; this makes it true at both layers.
--
-- Scoped to the pm_* tables on purpose. A blanket revoke across `public` would
-- also strip the anon reads that the pricing tables rely on.

revoke all on
  public.pm_projects, public.pm_tasks, public.pm_assignments,
  public.pm_equipment, public.pm_equipment_placements,
  public.pm_drying_areas, public.pm_moisture_readings,
  public.pm_documents, public.pm_milestones, public.pm_alerts,
  public.pm_briefs, public.pm_updates, public.pm_automation_settings
  from anon;

-- DELETE is granted nowhere in this schema. Nothing here is deleted: projects
-- are cancelled, equipment retired, assignments released, alerts resolved.
revoke delete on
  public.pm_projects, public.pm_tasks, public.pm_assignments,
  public.pm_equipment, public.pm_equipment_placements,
  public.pm_drying_areas, public.pm_moisture_readings,
  public.pm_documents, public.pm_milestones, public.pm_alerts,
  public.pm_briefs, public.pm_updates, public.pm_automation_settings
  from authenticated;

grant select, insert, update on
  public.pm_projects, public.pm_tasks, public.pm_assignments,
  public.pm_equipment, public.pm_equipment_placements,
  public.pm_drying_areas, public.pm_documents, public.pm_milestones,
  public.pm_alerts, public.pm_updates, public.pm_automation_settings
  to authenticated;

-- Append-only: no UPDATE grant, matching the absent UPDATE policy. Two layers
-- saying the same thing, because this is the moisture log an adjuster audits.
revoke update on public.pm_moisture_readings, public.pm_briefs from authenticated;
grant select, insert on public.pm_moisture_readings, public.pm_briefs to authenticated;
