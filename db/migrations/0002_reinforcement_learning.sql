-- ============================================================================
--  Atmosphere — reinforcement learning layer
--  See docs/reinforcement-learning.md for the architecture this implements.
--
--  Four tables, two privacy tiers:
--
--    GLOBAL  ai_arms, ai_arm_stats, ai_golden_cases
--            Aggregate numbers only — "gpt-5-mini with the structured prompt
--            scores 0.81 on small mitigation summaries". No customer content
--            whatsoever, so every organization's work improves the routing that
--            every other organization benefits from. Readable by any signed-in
--            user; writable only through the SECURITY DEFINER functions below.
--
--    ORG     ai_runs, ai_exemplars
--            These hold real job content. Strictly org-scoped by RLS, exactly
--            like every other table in this schema. One org's exemplars are
--            invisible to another at the database layer, not by convention.
--
--  That split is the point: we get cross-customer learning where it is safe
--  (which model is better) and keep it local where it is not (what the job said).
-- ============================================================================

-- ── Helpers ────────────────────────────────────────────────────────────────
-- Lives in `private` so it is not reachable as an RPC, matching the pattern
-- already used by the org policies.
create schema if not exists private;

create or replace function private.ai_is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id and m.user_id = auth.uid()
  );
$$;

revoke all on function private.ai_is_org_member(uuid) from public, anon, authenticated;


-- ── ai_arms — the action space ─────────────────────────────────────────────
create table if not exists public.ai_arms (
  id                uuid primary key default gen_random_uuid(),
  task_type         text not null,
  provider          text not null check (provider in ('openai','anthropic','google','xai','oss')),
  model             text not null,
  prompt_variant    text not null,
  temperature       numeric,
  max_output_tokens integer,
  status            text not null default 'candidate'
                      check (status in ('champion','candidate','retired')),
  created_at        timestamptz not null default now(),
  promoted_at       timestamptz,
  retired_at        timestamptz,
  retired_reason    text,
  unique (task_type, provider, model, prompt_variant)
);

-- Exactly one champion per task type. Enforced by the database rather than by
-- application code because a task type with two champions (or none) would make
-- routing non-deterministic in a way that is very hard to notice.
create unique index if not exists ai_arms_one_champion_per_task
  on public.ai_arms (task_type) where status = 'champion';

create index if not exists ai_arms_task_status on public.ai_arms (task_type, status);


-- ── ai_arm_stats — the learned posteriors ──────────────────────────────────
-- One row per (arm × context level). Rows exist at every level of the context
-- hierarchy: `draft_scope`, `draft_scope:mitigation`, `draft_scope:mitigation:large`.
-- Writing all levels on every run is what lets the router fall back to a broader
-- level when a narrow one has too little data.
create table if not exists public.ai_arm_stats (
  arm_id          uuid not null references public.ai_arms(id) on delete cascade,
  context_key     text not null,
  trials          integer not null default 0,
  reward_sum      numeric not null default 0,
  -- Beta posterior. Seeded from the arm's tier prior on first write, then
  -- updated with fractional counts since rewards are continuous in [0,1].
  alpha           numeric not null default 1,
  beta            numeric not null default 1,
  avg_cost_usd    numeric not null default 0,
  avg_latency_ms  numeric not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (arm_id, context_key)
);

create index if not exists ai_arm_stats_context on public.ai_arm_stats (context_key);


-- ── ai_runs — the episode log ──────────────────────────────────────────────
-- Every decision the policy ever made, with what it cost and how it landed.
-- This table is the training set: the promotion gate reads it, exemplar mining
-- reads it, and the preference-pair export for open-weights fine-tuning is
-- built from it.
create table if not exists public.ai_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  task_type       text not null,
  context_key     text not null,
  context_keys    text[] not null default '{}',
  arm_id          uuid not null references public.ai_arms(id),
  provider        text not null,
  model           text not null,
  prompt_variant  text not null,
  -- `shadow` runs are scored but never served to the user. High-stakes tasks
  -- use them to evaluate challengers at zero risk to the customer.
  mode            text not null default 'serve' check (mode in ('serve','shadow')),
  explored        boolean not null default false,
  selection_reason text,

  input_digest    text,          -- sha256 of the input; dedupes without storing it
  input_payload   jsonb,         -- retained for replay + exemplar mining
  output_text     text,
  input_tokens    integer not null default 0,
  output_tokens   integer not null default 0,
  cost_usd        numeric not null default 0,
  latency_ms      integer not null default 0,

  verifier_score  numeric,
  verifier_passed boolean,
  verifier_detail jsonb,

  disposition     text not null default 'pending'
                    check (disposition in ('pending','accepted','edited_minor','edited_major','rejected','failed')),
  edit_ratio      numeric,
  reward          numeric,
  reward_status   text not null default 'provisional'
                    check (reward_status in ('provisional','final')),

  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);

create index if not exists ai_runs_org_created on public.ai_runs (org_id, created_at desc);
create index if not exists ai_runs_arm_context on public.ai_runs (arm_id, context_key);
create index if not exists ai_runs_task_created on public.ai_runs (task_type, created_at desc);
-- Supports exemplar mining: "best final-rewarded runs for this org and task".
create index if not exists ai_runs_mining
  on public.ai_runs (org_id, task_type, reward desc)
  where reward_status = 'final';


-- ── ai_exemplars — the org's own accumulated know-how ──────────────────────
-- Mined from runs a human accepted. Injected as few-shot examples on later runs
-- of the same task, which is how the platform gets better at *an organization's*
-- particular way of working without training any weights.
create table if not exists public.ai_exemplars (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id) on delete cascade,
  task_type     text not null,
  context_key   text not null,
  input_payload jsonb not null,
  output_text   text not null,
  reward        numeric not null,
  source_run_id uuid references public.ai_runs(id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists ai_exemplars_lookup
  on public.ai_exemplars (org_id, task_type, reward desc) where active;


-- ── ai_golden_cases — the regression suite ─────────────────────────────────
-- The floor under the learning loop. A challenger must not regress on any of
-- these before it can be promoted, so the policy cannot drift somewhere worse
-- while its own metrics look fine. Deliberately global and content-free: cases
-- are synthetic or fully redacted before they are added.
create table if not exists public.ai_golden_cases (
  id            uuid primary key default gen_random_uuid(),
  task_type     text not null,
  label         text not null,
  input_payload jsonb not null,
  -- Optional expected output for exact-match tasks; when null the case is
  -- scored by the verifier alone.
  expected      jsonb,
  min_score     numeric not null default 0.9,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists ai_golden_cases_task on public.ai_golden_cases (task_type) where active;


-- ============================================================================
--  Row Level Security
-- ============================================================================

alter table public.ai_arms        enable row level security;
alter table public.ai_arm_stats   enable row level security;
alter table public.ai_runs        enable row level security;
alter table public.ai_exemplars   enable row level security;
alter table public.ai_golden_cases enable row level security;

-- Global tier: readable by any signed-in user (the router reads it on every
-- request under the caller's JWT). No write policy at all — writes happen only
-- through the SECURITY DEFINER functions below, or with the service role key.
drop policy if exists ai_arms_read on public.ai_arms;
create policy ai_arms_read on public.ai_arms
  for select to authenticated using (true);

drop policy if exists ai_arm_stats_read on public.ai_arm_stats;
create policy ai_arm_stats_read on public.ai_arm_stats
  for select to authenticated using (true);

drop policy if exists ai_golden_cases_read on public.ai_golden_cases;
create policy ai_golden_cases_read on public.ai_golden_cases
  for select to authenticated using (true);

-- Org tier: a member sees their own organization's rows and nothing else.
drop policy if exists ai_runs_read on public.ai_runs;
create policy ai_runs_read on public.ai_runs
  for select to authenticated using (private.ai_is_org_member(org_id));

drop policy if exists ai_exemplars_read on public.ai_exemplars;
create policy ai_exemplars_read on public.ai_exemplars
  for select to authenticated using (private.ai_is_org_member(org_id));


-- ============================================================================
--  Write path — SECURITY DEFINER functions
--
--  All learning writes go through these. Each one re-derives the caller from
--  auth.uid() and checks org membership internally, so the API surface cannot
--  be used to write a run into somebody else's organization or to hand-edit the
--  posteriors that drive routing.
-- ============================================================================

-- Apply one reward observation to an arm's posterior at one context level.
-- Called once per level of the hierarchy.
--
-- Delta semantics: p_old_reward null means "new observation" (trial count goes
-- up); non-null means "correcting a provisional reward" (trial count unchanged,
-- the old contribution is subtracted first). That is what makes the two-phase
-- reward exact instead of double-counted.
create or replace function private.ai_apply_reward(
  p_arm_id      uuid,
  p_context_key text,
  p_old_reward  numeric,
  p_new_reward  numeric,
  p_alpha_prior numeric,
  p_beta_prior  numeric,
  p_cost_usd    numeric,
  p_latency_ms  integer
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_old_reward is null then
    insert into public.ai_arm_stats as s
      (arm_id, context_key, trials, reward_sum, alpha, beta, avg_cost_usd, avg_latency_ms, updated_at)
    values
      (p_arm_id, p_context_key, 1, p_new_reward,
       p_alpha_prior + p_new_reward, p_beta_prior + (1 - p_new_reward),
       coalesce(p_cost_usd, 0), coalesce(p_latency_ms, 0), now())
    on conflict (arm_id, context_key) do update set
      trials         = s.trials + 1,
      reward_sum     = s.reward_sum + p_new_reward,
      alpha          = s.alpha + p_new_reward,
      beta           = s.beta + (1 - p_new_reward),
      -- Running means, so a cost spike does not need a full table scan to see.
      avg_cost_usd   = (s.avg_cost_usd * s.trials + coalesce(p_cost_usd, 0)) / (s.trials + 1),
      avg_latency_ms = (s.avg_latency_ms * s.trials + coalesce(p_latency_ms, 0)) / (s.trials + 1),
      updated_at     = now();
  else
    update public.ai_arm_stats set
      reward_sum = reward_sum + (p_new_reward - p_old_reward),
      alpha      = greatest(0.001, alpha + (p_new_reward - p_old_reward)),
      beta       = greatest(0.001, beta  + (p_old_reward - p_new_reward)),
      updated_at = now()
    where arm_id = p_arm_id and context_key = p_context_key;
  end if;
end;
$$;

revoke all on function private.ai_apply_reward(uuid, text, numeric, numeric, numeric, numeric, numeric, integer)
  from public, anon, authenticated;


-- Record a completed run and fold its provisional reward into the posteriors,
-- atomically. Returns the run id, which the client later uses to submit
-- feedback.
create or replace function public.ai_record_run(
  p_org_id           uuid,
  p_task_type        text,
  p_context_key      text,
  p_context_keys     text[],
  p_arm_id           uuid,
  p_provider         text,
  p_model            text,
  p_prompt_variant   text,
  p_mode             text,
  p_explored         boolean,
  p_selection_reason text,
  p_input_digest     text,
  p_input_payload    jsonb,
  p_output_text      text,
  p_input_tokens     integer,
  p_output_tokens    integer,
  p_cost_usd         numeric,
  p_latency_ms       integer,
  p_verifier_score   numeric,
  p_verifier_passed  boolean,
  p_verifier_detail  jsonb,
  p_reward           numeric,
  p_alpha_prior      numeric,
  p_beta_prior       numeric
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
  v_key    text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not private.ai_is_org_member(p_org_id) then
    raise exception 'not a member of this organization';
  end if;

  insert into public.ai_runs (
    org_id, user_id, task_type, context_key, context_keys, arm_id, provider, model,
    prompt_variant, mode, explored, selection_reason, input_digest, input_payload,
    output_text, input_tokens, output_tokens, cost_usd, latency_ms,
    verifier_score, verifier_passed, verifier_detail, reward, reward_status
  ) values (
    p_org_id, auth.uid(), p_task_type, p_context_key, p_context_keys, p_arm_id, p_provider,
    p_model, p_prompt_variant, coalesce(p_mode, 'serve'), coalesce(p_explored, false),
    p_selection_reason, p_input_digest, p_input_payload, p_output_text,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_cost_usd, 0),
    coalesce(p_latency_ms, 0), p_verifier_score, p_verifier_passed, p_verifier_detail,
    p_reward, 'provisional'
  ) returning id into v_run_id;

  -- Update every level of the context hierarchy so broader levels stay usable
  -- as a fallback for slices that are still sparse.
  if p_reward is not null then
    foreach v_key in array p_context_keys loop
      perform private.ai_apply_reward(
        p_arm_id, v_key, null, p_reward, p_alpha_prior, p_beta_prior, p_cost_usd, p_latency_ms
      );
    end loop;
  end if;

  return v_run_id;
end;
$$;

grant execute on function public.ai_record_run(
  uuid, text, text, text[], uuid, text, text, text, text, boolean, text, text, jsonb,
  text, integer, integer, numeric, integer, numeric, boolean, jsonb, numeric, numeric, numeric
) to authenticated;


-- Apply human feedback to a run and correct its already-counted reward.
-- Idempotent by design: resolving twice replaces the previous final reward
-- rather than adding a second observation.
create or replace function public.ai_resolve_run(
  p_run_id      uuid,
  p_disposition text,
  p_edit_ratio  numeric,
  p_reward      numeric
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.ai_runs%rowtype;
  v_key text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_run from public.ai_runs where id = p_run_id;
  if not found then
    raise exception 'run not found';
  end if;
  if not private.ai_is_org_member(v_run.org_id) then
    raise exception 'not a member of this organization';
  end if;

  foreach v_key in array v_run.context_keys loop
    perform private.ai_apply_reward(
      v_run.arm_id, v_key, coalesce(v_run.reward, 0), p_reward, 1, 1, null, null
    );
  end loop;

  update public.ai_runs set
    disposition   = p_disposition,
    edit_ratio    = p_edit_ratio,
    reward        = p_reward,
    reward_status = 'final',
    resolved_at   = now()
  where id = p_run_id;
end;
$$;

grant execute on function public.ai_resolve_run(uuid, text, numeric, numeric) to authenticated;


-- ============================================================================
--  Seed arms
--
--  A starting champion per task type plus two challengers, spread across
--  vendors so the loop has something to compare from day one. Arms whose
--  provider has no API key configured are skipped by the router at request
--  time, so this seed is safe regardless of which keys an operator has set.
--
--  These champions are an opening guess, not a recommendation — the whole point
--  of the system is that within a few hundred runs the data replaces them.
-- ============================================================================

insert into public.ai_arms (task_type, provider, model, prompt_variant, status, temperature)
values
  -- draft_scope: reasoning-heavy, quality-weighted
  ('draft_scope',              'anthropic', 'claude-sonnet-5',            'structured',  'champion',  0.2),
  ('draft_scope',              'openai',    'gpt-5',                      'baseline',    'candidate', 0.2),
  ('draft_scope',              'google',    'gemini-2.5-pro',             'structured',  'candidate', 0.2),

  -- estimate_line_items: high stakes, arithmetic-heavy
  ('estimate_line_items',      'anthropic', 'claude-opus-5',              'deliberate',  'champion',  0.0),
  ('estimate_line_items',      'openai',    'gpt-5',                      'deliberate',  'candidate', 0.0),
  ('estimate_line_items',      'xai',       'grok-4',                     'deliberate',  'candidate', 0.0),

  -- summarize_job_notes: high volume, cost-sensitive — the open-weights arm's
  -- best shot at winning outright
  ('summarize_job_notes',      'anthropic', 'claude-haiku-4-5-20251001',  'baseline',    'champion',  0.3),
  ('summarize_job_notes',      'google',    'gemini-2.5-flash',           'baseline',    'candidate', 0.3),
  ('summarize_job_notes',      'oss',       'llama-3.3-70b-instruct',     'structured',  'candidate', 0.3),
  ('summarize_job_notes',      'openai',    'gpt-5-mini',                 'baseline',    'candidate', 0.3),

  -- customer_update_email: high stakes (tone + commitments)
  ('customer_update_email',    'anthropic', 'claude-sonnet-5',            'baseline',    'champion',  0.4),
  ('customer_update_email',    'openai',    'gpt-5',                      'baseline',    'candidate', 0.4),

  -- extract_document_fields: high stakes, verbatim grounding
  ('extract_document_fields',  'google',    'gemini-2.5-pro',             'structured',  'champion',  0.0),
  ('extract_document_fields',  'anthropic', 'claude-sonnet-5',            'structured',  'candidate', 0.0),
  ('extract_document_fields',  'openai',    'gpt-5',                      'structured',  'candidate', 0.0),

  -- classify_moisture_reading: small, frequent, latency-sensitive
  ('classify_moisture_reading','anthropic', 'claude-haiku-4-5-20251001',  'baseline',    'champion',  0.0),
  ('classify_moisture_reading','oss',       'llama-3.3-70b-instruct',     'structured',  'candidate', 0.0),
  ('classify_moisture_reading','google',    'gemini-2.5-flash',           'baseline',    'candidate', 0.0)
on conflict (task_type, provider, model, prompt_variant) do nothing;
