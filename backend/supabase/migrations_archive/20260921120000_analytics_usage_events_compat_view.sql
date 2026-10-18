-- Growth analytics RPCs still reference public.usage_events after the legacy
-- credit ledger was dropped (20260910190000). The durable customer ledger is
-- public.token_usage_events. Expose a thin compatibility view so Internal
-- Product & growth (analytics_summary and friends) work again without
-- recreating the old credit wallet table.
--
-- Root cause error: relation "public.usage_events" does not exist

create or replace view public.usage_events as
select
  id,
  org_id,
  user_id,
  created_at,
  price_nanos,
  cost_nanos,
  feature::text as feature
from public.token_usage_events;

comment on view public.usage_events is
  'Compat alias over token_usage_events for growth analytics RPCs after the legacy credit ledger drop. Prefer token_usage_events for new code.';

grant select on public.usage_events to authenticated, service_role;
