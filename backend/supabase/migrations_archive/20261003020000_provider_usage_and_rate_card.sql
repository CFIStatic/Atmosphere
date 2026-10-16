-- ============================================================================
-- AI charges from provider-reported usage at official prices
-- ============================================================================
-- 1. token_usage_events stores what the provider's API response reported:
--    cache reads and 5m / 1h cache writes in their own columns, the provider,
--    and the raw provider usage object (`provider_usage`, jsonb) for audit.
--    `cache_tokens` stays the aggregate (total_tokens is generated from it).
--    `pricing_status` says how the row was priced, so a row with tokens but
--    no price is never silent.
-- 2. private.model_costs is set to each provider's official list price,
--    verified 2026-10-02 against
--      https://platform.claude.com/docs/en/about-claude/pricing
--      https://ai.google.dev/gemini-api/docs/pricing
--    and mirrors backend/src/metering/modelPriceTable.ts (a unit test keeps
--    the two equal). Claude Sonnet 5 was carried at $3/$15; the official
--    price is $2/$10. Gemini was carried at $0.10/$0.40 for every model; the
--    official prices are 3.6 Flash $0.75/$3.75 (through 2026-12-31),
--    3.5 Flash-Lite $0.30/$2.50. Gemini has no cache-WRITE charge (explicit
--    caches bill storage per hour), so its write multipliers are 0.
-- 3. record_token_usage accepts the new columns. All new parameters have
--    defaults, so a caller still sending the old named parameters resolves
--    to this one function.
-- 4. Re-prices the Claude Ask rows recorded at $0 while quote_usage was
--    unreachable (Sept 27 – Oct 1). Their raw provider usage was not stored,
--    so the cache split is unknown: every cache token is priced as a cache
--    READ (0.1× input), the lowest cache rate — the conservative assumption
--    that never over-charges. price = cost × the markup recorded on the row
--    at write time (metadata.customerMarkup, the backend's
--    USAGE_CUSTOMER_MARKUP; 10 when absent). Only rows with tokens > 0 AND
--    cost = 0 AND price = 0 are touched; a second run finds none.
-- ============================================================================

-- 1. Ledger columns ----------------------------------------------------------

alter table public.token_usage_events
  add column if not exists provider              text,
  add column if not exists cache_read_tokens     bigint not null default 0 check (cache_read_tokens >= 0),
  add column if not exists cache_write_5m_tokens bigint not null default 0 check (cache_write_5m_tokens >= 0),
  add column if not exists cache_write_1h_tokens bigint not null default 0 check (cache_write_1h_tokens >= 0),
  add column if not exists provider_usage        jsonb,
  add column if not exists pricing_status        text not null default 'priced';

do $$ begin
  alter table public.token_usage_events
    add constraint token_usage_events_pricing_status_check
    check (pricing_status in ('priced', 'unpriced', 'repriced_conservative', 'legacy'));
exception when duplicate_object then null; end $$;

comment on column public.token_usage_events.provider is
  'anthropic | google | openai | tavily — the provider whose API reported this usage.';
comment on column public.token_usage_events.cache_read_tokens is
  'Provider-reported cache hits (Anthropic cache_read_input_tokens, Gemini cachedContentTokenCount).';
comment on column public.token_usage_events.cache_write_5m_tokens is
  'Provider-reported 5-minute cache writes (Anthropic cache_creation.ephemeral_5m_input_tokens).';
comment on column public.token_usage_events.cache_write_1h_tokens is
  'Provider-reported 1-hour cache writes (Anthropic cache_creation.ephemeral_1h_input_tokens).';
comment on column public.token_usage_events.provider_usage is
  'Raw usage object(s) from the provider response, one entry per call: {"calls":[{"provider","model","usage"}]}. Audit only.';
comment on column public.token_usage_events.pricing_status is
  'priced: cost from the rate card. unpriced: tokens but the model has no price (alert). repriced_conservative: $0 row re-priced later with cache as reads. legacy: written before this column existed.';

-- Rows written before this migration carry no provider usage object: mark
-- them legacy. New code always writes provider_usage, so a re-run is a no-op.
update public.token_usage_events
set pricing_status = 'legacy'
where pricing_status = 'priced'
  and provider_usage is null;

-- Health check: new rows that spent tokens but carry no cost.
create index if not exists token_usage_events_unpriced
  on public.token_usage_events (created_at desc)
  where cost_nanos = 0 and total_tokens > 0;

-- 2. Official rate card -----------------------------------------------------

alter table private.model_costs
  add column if not exists price_source_url  text,
  add column if not exists price_verified_at date;

insert into private.model_costs (
  model_id, display_name, family, provider,
  input_cost_per_mtok, output_cost_per_mtok,
  cache_write_5m_multiplier, cache_write_1h_multiplier, cache_read_multiplier,
  context_window, max_output_tokens, sort_order, price_source_url, price_verified_at
) values
  ('claude-fable-5',        'Atmosphere Apex',       'apex',   'anthropic', 10.000000, 50.000000, 1.25, 2.0, 0.1, 1000000, 128000, 10, 'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-02'),
  ('claude-opus-5',         'Atmosphere Pro',        'pro',    'anthropic',  5.000000, 25.000000, 1.25, 2.0, 0.1, 1000000, 128000, 20, 'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-02'),
  ('claude-opus-4-8',       'Atmosphere Pro 4.8',    'pro',    'anthropic',  5.000000, 25.000000, 1.25, 2.0, 0.1, 1000000, 128000, 30, 'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-02'),
  ('claude-sonnet-5',       'Atmosphere Core',       'core',   'anthropic',  2.000000, 10.000000, 1.25, 2.0, 0.1, 1000000, 128000, 40, 'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-02'),
  ('claude-sonnet-4-6',     'Atmosphere Core 4.6',   'core',   'anthropic',  3.000000, 15.000000, 1.25, 2.0, 0.1, 1000000, 128000, 50, 'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-02'),
  ('claude-haiku-4-5',      'Atmosphere Lite',       'lite',   'anthropic',  1.000000,  5.000000, 1.25, 2.0, 0.1,  200000,  64000, 60, 'https://platform.claude.com/docs/en/about-claude/pricing', '2026-10-02'),
  -- Gemini 3.6 Flash: $0.75 / $3.75 through 2026-12-31, then $1.50 / $7.50.
  -- The backend prices by call time; update this row on 2027-01-01.
  ('gemini-3.6-flash',      'Gemini 3.6 Flash',      'gemini', 'google',     0.750000,  3.750000, 0,    0,   0.1, 1048576,  65536, 70, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-10-02'),
  ('gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', 'gemini', 'google',     0.300000,  2.500000, 0,    0,   0.1, 1048576,  65536, 71, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-10-02'),
  ('gemini-3.5-flash',      'Gemini 3.5 Flash',      'gemini', 'google',     1.500000,  9.000000, 0,    0,   0.1, 1048576,  65536, 72, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-10-02'),
  -- Text/image/video rate. Audio input is $1.00 (priced by the backend from promptTokensDetails).
  ('gemini-2.5-flash',      'Gemini 2.5 Flash',      'gemini', 'google',     0.300000,  2.500000, 0,    0,   0.1, 1048576,  65536, 73, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-10-02'),
  ('gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'gemini', 'google',     0.100000,  0.400000, 0,    0,   0.1, 1048576,  65536, 74, 'https://ai.google.dev/gemini-api/docs/pricing', '2026-10-02')
on conflict (model_id) do update set
  display_name              = excluded.display_name,
  family                    = excluded.family,
  provider                  = excluded.provider,
  input_cost_per_mtok       = excluded.input_cost_per_mtok,
  output_cost_per_mtok      = excluded.output_cost_per_mtok,
  cache_write_5m_multiplier = excluded.cache_write_5m_multiplier,
  cache_write_1h_multiplier = excluded.cache_write_1h_multiplier,
  cache_read_multiplier     = excluded.cache_read_multiplier,
  context_window            = excluded.context_window,
  max_output_tokens         = excluded.max_output_tokens,
  sort_order                = excluded.sort_order,
  price_source_url          = excluded.price_source_url,
  price_verified_at         = excluded.price_verified_at,
  is_active                 = true;

-- gemini-2.0-flash is retired on the Gemini API pricing page and nothing calls
-- it. Keep the row (history references it) but stop quoting it.
update private.model_costs set is_active = false where model_id = 'gemini-2.0-flash';

do $$ begin
  perform private.sync_rate_card();
exception when undefined_function then null; end $$;

-- 3. record_token_usage with provider-reported columns -----------------------

drop function if exists public.record_token_usage(
  uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz, bigint
);

create or replace function public.record_token_usage(
  p_org                   uuid,
  p_request_id            text,
  p_feature               text default null,
  p_source                text default null,
  p_user_id               uuid default null,
  p_job_id                uuid default null,
  p_model_id              text default null,
  p_input_tokens          bigint default 0,
  p_output_tokens         bigint default 0,
  p_cache_tokens          bigint default 0,
  p_price_nanos           bigint default 0,
  p_metadata              jsonb default '{}'::jsonb,
  p_at                    timestamptz default now(),
  p_cost_nanos            bigint default 0,
  p_provider              text default null,
  p_cache_read_tokens     bigint default 0,
  p_cache_write_5m_tokens bigint default 0,
  p_cache_write_1h_tokens bigint default 0,
  p_provider_usage        jsonb default null,
  p_pricing_status        text default null
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
  v_dup     boolean := false;
  v_split   bigint := greatest(coalesce(p_cache_read_tokens, 0), 0)
                    + greatest(coalesce(p_cache_write_5m_tokens, 0), 0)
                    + greatest(coalesce(p_cache_write_1h_tokens, 0), 0);
  v_status  text := case
                      when p_pricing_status in ('priced', 'unpriced', 'repriced_conservative', 'legacy') then p_pricing_status
                      -- Callers that do not say (older backends): tokens with no
                      -- cost and no price is an unpriced row, never a silent $0.
                      when coalesce(p_cost_nanos, 0) <= 0 and coalesce(p_price_nanos, 0) <= 0
                       and coalesce(p_input_tokens, 0) + coalesce(p_output_tokens, 0) + coalesce(p_cache_tokens, 0) > 0
                        then 'unpriced'
                      else 'priced'
                    end;
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
    input_tokens, output_tokens, cache_tokens,
    cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens,
    provider, provider_usage, pricing_status,
    cost_nanos, price_nanos, metadata, created_at
  ) values (
    p_org, v_user, p_job_id, btrim(p_request_id), v_feature,
    nullif(btrim(coalesce(p_source, p_feature, '')), ''),
    nullif(btrim(coalesce(p_model_id, '')), ''),
    greatest(coalesce(p_input_tokens, 0), 0),
    greatest(coalesce(p_output_tokens, 0), 0),
    -- The aggregate is never smaller than the provider-reported split.
    greatest(coalesce(p_cache_tokens, 0), v_split, 0),
    greatest(coalesce(p_cache_read_tokens, 0), 0),
    greatest(coalesce(p_cache_write_5m_tokens, 0), 0),
    greatest(coalesce(p_cache_write_1h_tokens, 0), 0),
    nullif(btrim(coalesce(p_provider, '')), ''),
    p_provider_usage,
    v_status,
    greatest(coalesce(p_cost_nanos, 0), 0),
    greatest(coalesce(p_price_nanos, 0), 0),
    coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_at, now())
  )
  on conflict (org_id, request_id) do nothing
  returning * into v_row;

  if v_row.id is null then
    v_dup := true;
    select * into v_row
    from public.token_usage_events
    where org_id = p_org and request_id = btrim(p_request_id);
  end if;

  return jsonb_build_object(
    'eventId', v_row.id,
    'duplicate', v_dup,
    'feature', v_row.feature,
    'inputTokens', v_row.input_tokens,
    'outputTokens', v_row.output_tokens,
    'cacheTokens', v_row.cache_tokens,
    'totalTokens', v_row.total_tokens,
    'costNanos', v_row.cost_nanos,
    'priceNanos', v_row.price_nanos,
    'pricingStatus', v_row.pricing_status
  );
end;
$$;

comment on function public.record_token_usage(
  uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz, bigint,
  text, bigint, bigint, bigint, jsonb, text
) is
  'Append one token-usage event: provider-reported tokens (cache read / 5m / 1h split), raw provider usage, cost_nanos (provider cost) and price_nanos (cost × markup). Idempotent on (org, request_id). Does not debit credits.';

revoke all on function public.record_token_usage(
  uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz, bigint,
  text, bigint, bigint, bigint, jsonb, text
) from public, anon;
grant execute on function public.record_token_usage(
  uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz, bigint,
  text, bigint, bigint, bigint, jsonb, text
) to authenticated, service_role;

-- 4. Re-price the $0 Claude rows ------------------------------------------------

with priced as (
  select
    e.id,
    round(
        e.input_tokens  * c.input_cost_per_mtok  * 1000
      + e.output_tokens * c.output_cost_per_mtok * 1000
      + e.cache_tokens  * c.input_cost_per_mtok  * 1000 * c.cache_read_multiplier
    )::bigint as cost_nanos,
    coalesce(
      case when (e.metadata->>'customerMarkup') ~ '^[0-9]+(\.[0-9]+)?$'
           then (e.metadata->>'customerMarkup')::numeric end,
      10
    ) as markup,
    c.input_cost_per_mtok, c.output_cost_per_mtok, c.cache_read_multiplier
  from public.token_usage_events e
  join private.model_costs c on c.model_id = e.model_id
  where e.cost_nanos = 0
    and e.price_nanos = 0
    and e.total_tokens > 0
    and e.model_id ~* '^claude-'
)
update public.token_usage_events e
set
  cost_nanos     = p.cost_nanos,
  price_nanos    = round(p.cost_nanos * greatest(p.markup, 1))::bigint,
  provider       = coalesce(e.provider, 'anthropic'),
  pricing_status = 'repriced_conservative',
  metadata       = e.metadata || jsonb_build_object(
    'repricing', jsonb_build_object(
      'migration', '20261003020000_provider_usage_and_rate_card',
      'reason', 'recorded at $0: quote_usage unreachable for the signed-in client after the 2026-09-23 grant lock-down',
      'cacheAssumption', 'cache_tokens priced as cache reads (0.1x input) - raw provider usage was not stored',
      'inputUsdPerMTok', p.input_cost_per_mtok,
      'outputUsdPerMTok', p.output_cost_per_mtok,
      'cacheReadMultiplier', p.cache_read_multiplier,
      'markup', p.markup,
      'rateCardVerifiedAt', '2026-10-02'
    )
  )
from priced p
where e.id = p.id
  and p.cost_nanos > 0
  and e.cost_nanos = 0
  and e.price_nanos = 0;
