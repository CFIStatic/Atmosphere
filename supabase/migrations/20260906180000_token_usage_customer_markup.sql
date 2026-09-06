-- ============================================================================
-- Customer token markup: store provider COGS and billable separately
-- ============================================================================
-- Settings → Billing → Token spend reads price_nanos. Until now that column
-- held the provider-cost estimate. Customers are billed at 10× COGS
-- (~90% gross margin on tokens). Keep both amounts so the multiplier can
-- change later without rewriting history.
--
-- Application write paths (recordAiCost, recordMeasuredTokenUsage) apply
-- USAGE_CUSTOMER_MARKUP / TOKEN_BILLABLE_MARKUP (default 10). This migration
-- only adds the column, updates the recorder, and backfills rows that already
-- have a positive stored cost. $0 rows stay $0 — we do not invent spend.
-- Seat / Stripe subscription prices are untouched.
-- ============================================================================

alter table public.token_usage_events
  add column if not exists cost_nanos bigint not null default 0 check (cost_nanos >= 0);

comment on column public.token_usage_events.cost_nanos is
  'Provider/COGS estimate in nanodollars. Customer charge is price_nanos.';

comment on column public.token_usage_events.price_nanos is
  'Customer/billable amount in nanodollars (cost × markup at write time).';

comment on table public.token_usage_events is
  'Customer-visible token meter. cost_nanos is provider COGS; price_nanos is the org billable (default 10×).';

-- Historical price_nanos meant different things by feature:
--   video_analysis — provider COGS (estimateCostUsd / verification_ai_costs)
--   ask/chat/other — quote_usage / record_usage sell price
--                    (cost × model_costs.markup, default 2)
-- Recover true COGS, then set billable = cost × 10. $0 rows stay $0.
update public.token_usage_events e
set cost_nanos = case
  when e.feature = 'video_analysis' then e.price_nanos
  else round(
    e.price_nanos / coalesce(nullif((
      select c.markup from private.model_costs c where c.model_id = e.model_id
    ), 0), 2.0)
  )::bigint
end
where e.cost_nanos = 0
  and e.price_nanos > 0;

update public.token_usage_events
set price_nanos = round(cost_nanos * 10)::bigint
where cost_nanos > 0
  and price_nanos <> round(cost_nanos * 10)::bigint;

-- Customer-facing quote. Same maths as private.price_usage, but cost_nanos
-- is stripped so provider COGS and model_costs.markup stay off PostgREST.
create or replace function public.quote_usage(
  p_model_id              text,
  p_input_tokens          bigint default 0,
  p_output_tokens         bigint default 0,
  p_cache_write_5m_tokens bigint default 0,
  p_cache_write_1h_tokens bigint default 0,
  p_cache_read_tokens     bigint default 0,
  p_is_batch              boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path to 'private', 'public', 'pg_temp'
as $$
  select private.price_usage(
    p_model_id, p_input_tokens, p_output_tokens,
    p_cache_write_5m_tokens, p_cache_write_1h_tokens, p_cache_read_tokens, p_is_batch
  ) - 'cost_nanos';
$$;

comment on function public.quote_usage is
  'Price a call. Returns price_nanos (model_costs.markup). cost_nanos is stripped so margin is never exposed via PostgREST.';

-- Replace the August 31 recorder. CREATE OR REPLACE cannot change the
-- argument list; leaving the old signature would make COMMENT ON FUNCTION
-- fail and leave an overload that still accepts PUBLIC execute.
drop function if exists public.record_token_usage(
  uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz
);

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
  p_at            timestamptz default now(),
  p_cost_nanos    bigint default 0
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

  if v_uid is not null and not private.is_org_member(p_org) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  v_user := coalesce(p_user_id, v_uid);
  v_feature := public.classify_token_feature(coalesce(p_feature, p_source));

  insert into public.token_usage_events (
    org_id, user_id, job_id, request_id, feature, source, model_id,
    input_tokens, output_tokens, cache_tokens, cost_nanos, price_nanos, metadata, created_at
  ) values (
    p_org, v_user, p_job_id, btrim(p_request_id), v_feature,
    nullif(btrim(coalesce(p_source, p_feature, '')), ''),
    nullif(btrim(coalesce(p_model_id, '')), ''),
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    greatest(coalesce(p_cache_tokens, 0), 0),
    greatest(coalesce(p_cost_nanos, 0), 0),
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
      'costNanos', v_row.cost_nanos,
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
    'costNanos', v_row.cost_nanos,
    'priceNanos', v_row.price_nanos
  );
end;
$$;

comment on function public.record_token_usage(
  uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz, bigint
) is
  'Append one token-usage event with cost_nanos (COGS) and price_nanos (billable). Idempotent on (org, request_id). Does not debit credits.';

revoke all on function public.record_token_usage(
  uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz, bigint
) from public, anon;
grant execute on function public.record_token_usage(
  uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz, bigint
) to authenticated, service_role;
