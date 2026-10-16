-- ============================================================================
-- Customer-facing token usage ledger (Settings → Billing)
-- ============================================================================
-- Video analysis, chat, and Ask all spend tokens. Those counts used to live
-- in separate tables (usage_events, verification_ai_costs, ai_usage_events)
-- and never reached the bill payer. This ledger is the one place a Global
-- Admin can read org-wide and per-employee token spend.
--
-- Recording is observability, not a credit draw-down. Charge still happens
-- through record_usage / Stripe; this table must never fail a model call.
-- ============================================================================

do $$ begin
  create type public.token_usage_feature as enum (
    'video_analysis',
    'chat',
    'ask',
    'other'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Classify a free-form feature / action string into the four buckets.
-- ---------------------------------------------------------------------------

create or replace function public.classify_token_feature(p_feature text)
returns public.token_usage_feature
language sql
immutable
as $$
  select case
    when p_feature is null or btrim(p_feature) = '' then 'other'::public.token_usage_feature
    when lower(p_feature) in (
      'video_analysis', 'verification', 'llm_verifier', 'vision', 'analyzer',
      'proof_analysis', 'frame_analysis', 'video', 'vision_analyzer',
      'work_event_verification', 'escalation', 'clip_analysis'
    )
      or lower(p_feature) ~ '(^|[_-])(video|verif|analys|vision|frame)([_-]|$)'
      then 'video_analysis'::public.token_usage_feature
    when lower(p_feature) in (
      'ask', 'clip_ask', 'proof_ask', 'job_ask', 'job-ask', 'clip-ask', 'proof-ask'
    )
      or lower(p_feature) ~ '(^|[_-])ask([_-]|$)'
      then 'ask'::public.token_usage_feature
    when lower(p_feature) in (
      'chat', 'model_completion', 'field_assistant', 'technician',
      'voice', 'assist', 'field-assistant', 'technician_assist', 'field_assist'
    )
      or lower(p_feature) ~ '(chat|assist|voice|completion)'
      then 'chat'::public.token_usage_feature
    else 'other'::public.token_usage_feature
  end;
$$;

comment on function public.classify_token_feature(text) is
  'Maps a model-call feature/action string onto video_analysis, chat, ask, or other.';

revoke all on function public.classify_token_feature(text) from public, anon;
grant execute on function public.classify_token_feature(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Immutable per-call token events
-- ---------------------------------------------------------------------------

create table if not exists public.token_usage_events (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  job_id          uuid,
  request_id      text not null,
  feature         public.token_usage_feature not null,
  source          text,
  model_id        text,
  input_tokens    bigint not null default 0 check (input_tokens >= 0),
  output_tokens   bigint not null default 0 check (output_tokens >= 0),
  cache_tokens    bigint not null default 0 check (cache_tokens >= 0),
  total_tokens    bigint generated always as (input_tokens + output_tokens + cache_tokens) stored,
  price_nanos     bigint not null default 0 check (price_nanos >= 0),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint token_usage_events_idempotency unique (org_id, request_id)
);

comment on table public.token_usage_events is
  'Customer-visible token meter. One row per model call: video analysis, chat, Ask, or other.';

create index if not exists token_usage_events_org_time
  on public.token_usage_events (org_id, created_at desc);

create index if not exists token_usage_events_org_user_time
  on public.token_usage_events (org_id, user_id, created_at desc);

create index if not exists token_usage_events_org_feature_time
  on public.token_usage_events (org_id, feature, created_at desc);

alter table public.token_usage_events enable row level security;

drop policy if exists token_usage_events_select on public.token_usage_events;
create policy token_usage_events_select on public.token_usage_events
  for select using (private.can_manage_billing(org_id));

-- ---------------------------------------------------------------------------
-- record_token_usage — idempotent, never draws credits
-- ---------------------------------------------------------------------------

create or replace function public.record_token_usage(
  p_org           uuid,
  p_request_id    text,
  p_feature       text default null,
  p_source        text default null,
  p_user_id       uuid default null,
  p_job_id        uuid default null,
  p_model_id      text default null,
  p_input_tokens  bigint default 0,
  p_output_tokens bigint default 0,
  p_cache_tokens  bigint default 0,
  p_price_nanos   bigint default 0,
  p_metadata      jsonb default '{}'::jsonb,
  p_at            timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid     uuid := auth.uid();
  v_user    uuid;
  v_feature public.token_usage_feature;
  v_row     public.token_usage_events%rowtype;
begin
  if coalesce(btrim(p_request_id), '') = '' then
    raise exception 'request_id_required' using errcode = '22023';
  end if;

  -- Authenticated callers must belong to the org. Service role (uid is null)
  -- records background video analysis on behalf of the org.
  if v_uid is not null and not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  v_user := coalesce(p_user_id, v_uid);
  v_feature := public.classify_token_feature(coalesce(p_feature, p_source));

  insert into public.token_usage_events (
    org_id, user_id, job_id, request_id, feature, source, model_id,
    input_tokens, output_tokens, cache_tokens, price_nanos, metadata, created_at
  ) values (
    p_org, v_user, p_job_id, btrim(p_request_id), v_feature,
    nullif(btrim(coalesce(p_source, p_feature, '')), ''),
    nullif(btrim(coalesce(p_model_id, '')), ''),
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    greatest(coalesce(p_cache_tokens, 0), 0),
    greatest(coalesce(p_price_nanos, 0), 0),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_at, now())
  )
  on conflict (org_id, request_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.token_usage_events
    where org_id = p_org and request_id = btrim(p_request_id);

    return jsonb_build_object(
      'eventId', v_row.id,
      'duplicate', true,
      'feature', v_row.feature,
      'inputTokens', v_row.input_tokens,
      'outputTokens', v_row.output_tokens,
      'cacheTokens', v_row.cache_tokens,
      'totalTokens', v_row.total_tokens,
      'priceNanos', v_row.price_nanos
    );
  end if;

  return jsonb_build_object(
    'eventId', v_row.id,
    'duplicate', false,
    'feature', v_row.feature,
    'inputTokens', v_row.input_tokens,
    'outputTokens', v_row.output_tokens,
    'cacheTokens', v_row.cache_tokens,
    'totalTokens', v_row.total_tokens,
    'priceNanos', v_row.price_nanos
  );
end;
$$;

comment on function public.record_token_usage is
  'Append one token-usage event. Idempotent on (org, request_id). Does not debit credits.';

revoke all on function public.record_token_usage from public, anon;
grant execute on function public.record_token_usage to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Attribute video-analysis cost rows to a user when we can
-- ---------------------------------------------------------------------------

alter table public.verification_ai_costs
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists verification_ai_costs_org_user_idx
  on public.verification_ai_costs (org_id, user_id)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- Backfill existing credit-ledger and video-analysis rows
-- ---------------------------------------------------------------------------

insert into public.token_usage_events (
  org_id, user_id, request_id, feature, source, model_id,
  input_tokens, output_tokens, cache_tokens, price_nanos, created_at
)
select
  e.org_id,
  e.user_id,
  e.request_id,
  public.classify_token_feature(e.feature),
  e.feature,
  e.model_id,
  e.input_tokens,
  e.output_tokens,
  coalesce(e.cache_write_5m_tokens, 0)
    + coalesce(e.cache_write_1h_tokens, 0)
    + coalesce(e.cache_read_tokens, 0),
  e.price_nanos,
  e.created_at
from public.usage_events e
on conflict (org_id, request_id) do nothing;

insert into public.token_usage_events (
  org_id, user_id, job_id, request_id, feature, source, model_id,
  input_tokens, output_tokens, cache_tokens, price_nanos, created_at
)
select
  c.org_id,
  c.user_id,
  c.job_id,
  'verification:' || c.id::text,
  'video_analysis'::public.token_usage_feature,
  'video_analysis',
  c.model_name,
  c.input_tokens,
  c.output_tokens,
  0,
  greatest(round(c.estimated_cost_usd * 1000000000)::bigint, 0),
  c.created_at
from public.verification_ai_costs c
on conflict (org_id, request_id) do nothing;
