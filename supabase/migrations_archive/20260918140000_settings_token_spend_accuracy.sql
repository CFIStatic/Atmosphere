-- ============================================================================
-- Settings token spend: Gemini COGS so price_nanos matches actual usage
-- ============================================================================
-- Settings → Billing sums token_usage_events.price_nanos for the signed-in org.
-- cost_nanos is provider COGS. price_nanos is the org billable (cost × 10).
--
-- Ask/chat on Gemini were written with both columns at 0: quote_usage raises
-- unknown_model because those ids are not on the Claude rate card, and the
-- API treated that failure as zero. Tokens still counted, so the spend number
-- did not match usage. Video analysis already uses $0.10 / $0.40 per million
-- tokens. This migration:
--   1. Returns cost_nanos from quote_usage so the API applies the 10× markup
--      once. price_nanos on that RPC stays cost × model_costs.markup (the
--      legacy 2× rate card) and is not the customer billable.
--   2. Seeds the Gemini ids the product actually calls, at the same COGS.
--   3. Backfills only rows that are still $0. Existing priced rows, including
--      video analysis, are not rewritten.

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
  );
$$;

comment on function public.quote_usage(text, bigint, bigint, bigint, bigint, bigint, boolean) is
  'Price a call. cost_nanos is provider COGS. price_nanos is cost × model_costs.markup (rate-card resale, not the 10× token billable).';

insert into private.model_costs (
  model_id, display_name, family, provider,
  input_cost_per_mtok, output_cost_per_mtok,
  context_window, max_output_tokens, sort_order
) values
  ('gemini-3.6-flash',      'Gemini 3.6 Flash',      'gemini', 'google', 0.100000, 0.400000, 1000000, 65536, 70),
  ('gemini-3.5-flash-lite', 'Gemini 3.5 Flash Lite', 'gemini', 'google', 0.100000, 0.400000, 1000000, 65536, 71),
  ('gemini-2.5-flash',      'Gemini 2.5 Flash',      'gemini', 'google', 0.100000, 0.400000, 1000000, 65536, 72),
  ('gemini-2.0-flash',      'Gemini 2.0 Flash',      'gemini', 'google', 0.100000, 0.400000, 1000000, 65536, 73)
on conflict (model_id) do update set
  display_name         = excluded.display_name,
  family               = excluded.family,
  provider             = excluded.provider,
  input_cost_per_mtok  = excluded.input_cost_per_mtok,
  output_cost_per_mtok = excluded.output_cost_per_mtok,
  is_active            = true,
  sort_order           = excluded.sort_order;

-- Zero-price Gemini events: COGS = input*100 + output*400 + cache*100 nanos
-- (usd_per_mtok * 1000). Billable = COGS × 10. Leave any positive price alone.
update public.token_usage_events e
set
  cost_nanos = v.cogs,
  price_nanos = v.cogs * 10
from (
  select
    id,
    (input_tokens * 100 + output_tokens * 400 + cache_tokens * 100)::bigint as cogs
  from public.token_usage_events
  where price_nanos = 0
    and cost_nanos = 0
    and (input_tokens + output_tokens + cache_tokens) > 0
    and model_id ~* '^gemini([^[:alnum:]]|$)'
) v
where e.id = v.id
  and v.cogs > 0;

-- Cost was recorded but billable was not. Same 10× rule, no invented tokens.
update public.token_usage_events
set price_nanos = cost_nanos * 10
where price_nanos = 0
  and cost_nanos > 0;
