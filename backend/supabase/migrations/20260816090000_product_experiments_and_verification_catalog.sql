-- ============================================================================
-- Product experiments (A/B) + Work Verification feature catalog
-- ----------------------------------------------------------------------------
-- Extends growth analytics for Atmosphere-internal monitoring:
--
--   1. Sticky experiment assignments (per user, deterministic when new)
--   2. Append-only experiment events (exposure / conversion / custom)
--   3. Feature catalog rows for the Verification + Field surfaces so time-spent
--      heartbeats from those pages show up on /analytics
--
-- Access: assign/track RPCs run as the signed-in user (RLS + auth.uid).
-- Reporting is SECURITY DEFINER and re-checks analytics_staff internal scope.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Experiments
-- ---------------------------------------------------------------------------

create table if not exists public.experiments (
  key          text primary key
               check (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  name         text not null,
  description  text,
  status       text not null default 'draft'
               check (status in ('draft', 'running', 'paused', 'completed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.experiment_variants (
  experiment_key text not null references public.experiments(key) on delete cascade,
  variant_key    text not null
                 check (variant_key ~ '^[a-z][a-z0-9_]{0,31}$'),
  label          text not null,
  weight         integer not null default 1 check (weight > 0 and weight <= 1000),
  primary key (experiment_key, variant_key)
);

create table if not exists public.experiment_assignments (
  experiment_key text not null references public.experiments(key) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  org_id         uuid references public.orgs(id) on delete set null,
  variant_key    text not null,
  assigned_at    timestamptz not null default now(),
  primary key (experiment_key, user_id),
  foreign key (experiment_key, variant_key)
    references public.experiment_variants(experiment_key, variant_key)
);

create table if not exists public.experiment_events (
  id             bigserial primary key,
  experiment_key text not null references public.experiments(key) on delete cascade,
  variant_key    text not null,
  user_id        uuid not null references auth.users(id) on delete cascade,
  org_id         uuid references public.orgs(id) on delete set null,
  event_name     text not null
                 check (event_name ~ '^[a-z][a-z0-9_]{1,48}$'),
  props          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists experiment_events_exp_created_idx
  on public.experiment_events (experiment_key, created_at desc);
create index if not exists experiment_events_user_idx
  on public.experiment_events (user_id, created_at desc);

alter table public.experiments enable row level security;
alter table public.experiment_variants enable row level security;
alter table public.experiment_assignments enable row level security;
alter table public.experiment_events enable row level security;

-- Authenticated users may read running experiment definitions (needed to know
-- which keys exist). Mutations go through SECURITY DEFINER RPCs below.
drop policy if exists experiments_select_running on public.experiments;
create policy experiments_select_running on public.experiments
  for select to authenticated
  using (status = 'running' or exists (
    select 1 from public.analytics_staff s where s.user_id = auth.uid()
  ));

drop policy if exists experiment_variants_select on public.experiment_variants;
create policy experiment_variants_select on public.experiment_variants
  for select to authenticated
  using (
    exists (
      select 1 from public.experiments e
      where e.key = experiment_key
        and (e.status = 'running' or exists (
          select 1 from public.analytics_staff s where s.user_id = auth.uid()
        ))
    )
  );

drop policy if exists experiment_assignments_select_self on public.experiment_assignments;
create policy experiment_assignments_select_self on public.experiment_assignments
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists experiment_events_select_self on public.experiment_events;
create policy experiment_events_select_self on public.experiment_events
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.analytics_staff s where s.user_id = auth.uid() and s.scope = 'internal')
  );

-- ---------------------------------------------------------------------------
-- 2. Assign + track RPCs
-- ---------------------------------------------------------------------------

create or replace function public.assign_experiment(p_experiment text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_existing text;
  v_org uuid;
  v_variant text;
  v_total int;
  v_roll int;
  v_acc int := 0;
  r record;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select status into v_status from public.experiments where key = p_experiment;
  if v_status is null then
    raise exception 'unknown_experiment' using errcode = 'P0002';
  end if;
  if v_status <> 'running' then
    raise exception 'experiment_not_running' using errcode = 'P0001';
  end if;

  select variant_key into v_existing
  from public.experiment_assignments
  where experiment_key = p_experiment and user_id = v_uid;

  if v_existing is not null then
    return jsonb_build_object(
      'experimentKey', p_experiment,
      'variantKey', v_existing,
      'sticky', true
    );
  end if;

  select om.org_id into v_org
  from public.org_members om
  where om.user_id = v_uid
  limit 1;

  select coalesce(sum(weight), 0) into v_total
  from public.experiment_variants
  where experiment_key = p_experiment;

  if v_total <= 0 then
    raise exception 'experiment_has_no_variants' using errcode = 'P0001';
  end if;

  -- Deterministic roll from user id + experiment key so refreshes and
  -- multi-device do not reshuffle before the sticky row lands.
  v_roll := (
    ('x' || substr(md5(v_uid::text || ':' || p_experiment), 1, 8))::bit(32)::int
  );
  if v_roll < 0 then v_roll := -v_roll; end if;
  v_roll := (v_roll % v_total) + 1;

  for r in
    select variant_key, weight
    from public.experiment_variants
    where experiment_key = p_experiment
    order by variant_key
  loop
    v_acc := v_acc + r.weight;
    if v_roll <= v_acc then
      v_variant := r.variant_key;
      exit;
    end if;
  end loop;

  if v_variant is null then
    select variant_key into v_variant
    from public.experiment_variants
    where experiment_key = p_experiment
    order by variant_key
    limit 1;
  end if;

  insert into public.experiment_assignments (experiment_key, user_id, org_id, variant_key)
  values (p_experiment, v_uid, v_org, v_variant)
  on conflict (experiment_key, user_id) do nothing;

  select variant_key into v_variant
  from public.experiment_assignments
  where experiment_key = p_experiment and user_id = v_uid;

  insert into public.experiment_events (experiment_key, variant_key, user_id, org_id, event_name)
  values (p_experiment, v_variant, v_uid, v_org, 'exposure');

  return jsonb_build_object(
    'experimentKey', p_experiment,
    'variantKey', v_variant,
    'sticky', false
  );
end;
$$;

revoke all on function public.assign_experiment(text) from public, anon;
grant execute on function public.assign_experiment(text) to authenticated;

create or replace function public.track_experiment_event(
  p_experiment text,
  p_event text,
  p_props jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_variant text;
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_event is null or p_event !~ '^[a-z][a-z0-9_]{1,48}$' then
    raise exception 'invalid_event' using errcode = '22023';
  end if;

  select variant_key, org_id into v_variant, v_org
  from public.experiment_assignments
  where experiment_key = p_experiment and user_id = v_uid;

  if v_variant is null then
    -- Auto-assign if the experiment is running so clients can track without
    -- a separate assign round-trip.
    perform public.assign_experiment(p_experiment);
    select variant_key, org_id into v_variant, v_org
    from public.experiment_assignments
    where experiment_key = p_experiment and user_id = v_uid;
  end if;

  if v_variant is null then
    raise exception 'not_assigned' using errcode = 'P0002';
  end if;

  insert into public.experiment_events (
    experiment_key, variant_key, user_id, org_id, event_name, props
  ) values (
    p_experiment, v_variant, v_uid, v_org, p_event, coalesce(p_props, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.track_experiment_event(text, text, jsonb) from public, anon;
grant execute on function public.track_experiment_event(text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Internal reporting
-- ---------------------------------------------------------------------------

create or replace function public.analytics_experiments(
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_analytics('internal');

  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by x.experiment_key)
    from (
      select
        e.key as experiment_key,
        e.name,
        e.status,
        e.description,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'variantKey', v.variant_key,
            'label', v.label,
            'weight', v.weight,
            'assignments', (
              select count(*)::int from public.experiment_assignments a
              where a.experiment_key = e.key and a.variant_key = v.variant_key
            ),
            'exposures', (
              select count(*)::int from public.experiment_events ev
              where ev.experiment_key = e.key
                and ev.variant_key = v.variant_key
                and ev.event_name = 'exposure'
                and ev.created_at >= p_from and ev.created_at < p_to
            ),
            'conversions', (
              select count(*)::int from public.experiment_events ev
              where ev.experiment_key = e.key
                and ev.variant_key = v.variant_key
                and ev.event_name = 'conversion'
                and ev.created_at >= p_from and ev.created_at < p_to
            ),
            'events', (
              select count(*)::int from public.experiment_events ev
              where ev.experiment_key = e.key
                and ev.variant_key = v.variant_key
                and ev.created_at >= p_from and ev.created_at < p_to
            )
          ) order by v.variant_key)
          from public.experiment_variants v
          where v.experiment_key = e.key
        ), '[]'::jsonb) as variants
      from public.experiments e
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.analytics_experiments(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_experiments(timestamptz, timestamptz) to authenticated;

-- Seed a starter experiment Atmosphere can flip on when ready.
insert into public.experiments (key, name, description, status) values
  (
    'intake_cta_copy',
    'Intake CTA copy',
    'A/B the primary approve-and-invite button label on Start a job.',
    'paused'
  )
on conflict (key) do nothing;

insert into public.experiment_variants (experiment_key, variant_key, label, weight) values
  ('intake_cta_copy', 'control', 'Approve & invite', 1),
  ('intake_cta_copy', 'proof_first', 'Publish brief & invite crew', 1)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Verification + Field feature catalog (time-spent tracking)
-- ---------------------------------------------------------------------------

insert into public.feature_catalog (key, label, area, description, sort_order) values
  ('app_shell',          'App shell',            'Platform',      'Whole console session (sidebar / navigation)',                    10),
  ('job_intake',         'Start a job',          'Verification',  'Paste scope → approve package → invite Field Capture',           20),
  ('job_files',          'Job files',            'Verification',  'Shared job dashboard — briefs, parties, proof days',             30),
  ('verifier_library',   'Verifier library',     'Verification',  'Office clip library and AI vs scope readings',                   40),
  ('my_jobs',            'My jobs',              'Field',         'Cross-GC claimed jobs list for field identity',                  50),
  ('job_share',          'Job share record',     'Field',         'Tokenized subcontractor job record',                             60),
  ('field_capture_web',  'Field Capture (web)',  'Field',         'Browser capture surface time (when instrumented)',               70),
  ('evidence_share',     'Evidence shares',      'Verification',  'Creating and reviewing outward evidence shares',                 80)
on conflict (key) do update
  set label = excluded.label,
      area = excluded.area,
      description = excluded.description,
      sort_order = excluded.sort_order,
      is_active = true;
