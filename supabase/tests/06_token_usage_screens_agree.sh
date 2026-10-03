#!/usr/bin/env bash
#
# Settings › Billing and Analytics › Token usage read one ledger
# (token_usage_events). This checks the SQL side of that promise on a
# database that already has every migration applied (the one
# `npm run migrate:manifest` builds), inside a transaction that is rolled back:
#
#   - admin_token_usage_analytics totals, per customer and per feature equal
#     direct sums of the ledger for the same window
#   - Tavily / Gemini-search rows land in the 'web_search' feature, research in
#     'ask' (classify_token_feature)
#   - ai_allowance_totals counts web search in the period spend
#   - settle_ai_usage records an allocation (it raised 42702 "allowance_nanos
#     is ambiguous" before 20261003190100), is idempotent per request, and
#     draws purchased credit once the allowance is used
#   - legacy Gemini rows priced at the old $0.10/$0.40 rate are re-priced by
#     20261003190100 to tokens × official rate × 10, once (idempotent), and
#     every other row keeps its amount
#
# Fixture rows are synthetic TEST DATA. Nothing is committed.
#
# Usage:  METERING_TEST_DB=atmosphere_migration_manifest \
#           supabase/tests/06_token_usage_screens_agree.sh [psql-connection-args...]
#
set -euo pipefail

DB="${METERING_TEST_DB:-atmosphere_migration_manifest}"
MIGRATION="$(cd "$(dirname "$0")/../migrations" && pwd)/20261003190100_metering_web_search_and_settle_fix.sql"
PSQL=(psql "$@" -q -X -v ON_ERROR_STOP=1 -v migration="$MIGRATION" -d "$DB")

"${PSQL[@]}" >/dev/null <<'SQL'
\set QUIET on
begin;

create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

-- Staff user for the Analytics RPC; org for the ledger.
insert into auth.users (id, email) values
  ('5aff0000-0000-4000-8000-000000000001', 'staff@test.invalid'),
  ('0e000000-0000-4000-8000-000000000001', 'owner@test.invalid');
insert into public.analytics_staff (user_id, scope) values ('5aff0000-0000-4000-8000-000000000001', 'internal');
insert into public.orgs (id, name, join_code) values
  ('a0000000-0000-4000-8000-0000000000aa', 'TEST Org A', 'TEST-A-06'),
  ('b0000000-0000-4000-8000-0000000000bb', 'TEST Org B', 'TEST-B-06');

-- Only the fixture rows are in this window (far future, so real rows never mix in).
create temp table w as select timestamptz '2031-01-01 00:00Z' as f, timestamptz '2031-01-31 00:00Z' as t;

insert into public.token_usage_events
  (org_id, user_id, request_id, feature, source, model_id, input_tokens, output_tokens, cost_nanos, price_nanos, created_at)
values
  ('a0000000-0000-4000-8000-0000000000aa', '0e000000-0000-4000-8000-000000000001', 't06-1', public.classify_token_feature('ask'), 'proof_ask', 'claude-opus-5', 6000, 900, 52500000, 525000000, '2031-01-02Z'),
  ('a0000000-0000-4000-8000-0000000000aa', '0e000000-0000-4000-8000-000000000001', 't06-2', public.classify_token_feature('research'), 'proof_ask', 'claude-sonnet-5', 4000, 600, 14000000, 140000000, '2031-01-03Z'),
  ('a0000000-0000-4000-8000-0000000000aa', '0e000000-0000-4000-8000-000000000001', 't06-3', public.classify_token_feature('web_search'), 'tavily', 'tavily-search', 0, 0, 8000000, 80000000, '2031-01-03Z'),
  ('a0000000-0000-4000-8000-0000000000aa', null, 't06-4', public.classify_token_feature('video_analysis'), 'proof_analysis', 'claude-opus-5', 15000, 700, 92500000, 925000000, '2031-01-04Z'),
  ('b0000000-0000-4000-8000-0000000000bb', null, 't06-5', public.classify_token_feature('ask'), 'clip_ask', 'gemini-3.6-flash', 1000, 100, 1125000, 11250000, '2031-01-05Z'),
  -- Outside the window.
  ('a0000000-0000-4000-8000-0000000000aa', null, 't06-6', 'ask', 'proof_ask', 'claude-opus-5', 9000, 1000, 70000000, 700000000, '2031-02-02Z');

select pg_temp.expect(
  (select feature::text from public.token_usage_events where request_id = 't06-3') = 'web_search',
  'a Tavily search is classified as web_search');
select pg_temp.expect(
  (select feature::text from public.token_usage_events where request_id = 't06-2') = 'ask',
  'a research turn is classified as ask');

select set_config('request.jwt.claim.sub', '5aff0000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"5aff0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
create temp table r as select public.admin_token_usage_analytics(w.f, w.t) as j from w;

select pg_temp.expect(
  (select (j->'totals'->>'priceNanos')::bigint from r)
    = (select sum(price_nanos) from public.token_usage_events e, w where e.created_at >= w.f and e.created_at < w.t),
  'Analytics total $ = ledger sum for the window');
select pg_temp.expect(
  (select (j->'totals'->>'eventCount')::int from r)
    = (select count(*) from public.token_usage_events e, w where e.created_at >= w.f and e.created_at < w.t),
  'Analytics call count = ledger rows for the window');
select pg_temp.expect(
  (select (c->>'priceNanos')::bigint from r, jsonb_array_elements(j->'byCustomer') c
     where c->>'orgId' = 'a0000000-0000-4000-8000-0000000000aa')
    = (select sum(price_nanos) from public.token_usage_events e, w
        where e.org_id = 'a0000000-0000-4000-8000-0000000000aa' and e.created_at >= w.f and e.created_at < w.t),
  'Analytics per-customer $ = that org''s ledger sum (what its Billing shows)');
select pg_temp.expect(
  (select (f->>'priceNanos')::bigint from r, jsonb_array_elements(j->'byFeature') f where f->>'feature' = 'web_search') = 80000000,
  'Analytics shows web search as its own line ($0.08 for one basic search)');
select pg_temp.expect(
  (select (m->>'priceNanos')::bigint from r, jsonb_array_elements(j->'byModel') m where m->>'model' = 'claude-sonnet-5') > 0,
  'Claude is priced on Analytics');

-- Allowance: web search is in the period spend (at provider cost).
select pg_temp.expect(
  (select a.period_spend_nanos from w, public.ai_allowance_totals(
     'a0000000-0000-4000-8000-0000000000aa', w.f, w.t, w.f) a)
    = 52500000 + 14000000 + 8000000 + 92500000,
  'allowance period spend includes web search and video analysis');
select pg_temp.expect(
  (select (a.by_feature->>'web_search')::bigint from w, public.ai_allowance_totals(
     'a0000000-0000-4000-8000-0000000000aa', w.f, w.t, w.f) a) = 8000000,
  'allowance by-feature has a web_search line');

-- Settlement: used to raise 42702 on every call with a billing period.
insert into public.ai_credit_ledger (org_id, delta_nanos, kind, request_id, note)
values ('a0000000-0000-4000-8000-0000000000aa', 50000000, 'purchase', 't06-credit', 'TEST');
select pg_temp.expect(
  (select applied and allowance_nanos = 8000000 and credit_nanos = 0
     from public.settle_ai_usage('a0000000-0000-4000-8000-0000000000aa', 't06-3', 8000000, 8000000, 0,
       '2031-01-03Z', 10000000, (select f from w), (select t from w), (select f from w), 10000000, 0)),
  'settle_ai_usage records an allocation inside the allowance');
select pg_temp.expect(
  (select allowance_nanos = 8000000
     from public.settle_ai_usage('a0000000-0000-4000-8000-0000000000aa', 't06-3', 8000000, 8000000, 0,
       '2031-01-03Z', 10000000, (select f from w), (select t from w), (select f from w), 10000000, 0))
  and (select count(*) from public.ai_usage_allocations where request_id = 't06-3') = 1,
  'settle_ai_usage is idempotent per request');
select pg_temp.expect(
  (select credit_applied and allowance_nanos = 2000000 and credit_nanos = 12000000
     from public.settle_ai_usage('a0000000-0000-4000-8000-0000000000aa', 't06-2', 14000000, 14000000, 0,
       '2031-01-03Z', 10000000, (select f from w), (select t from w), (select f from w), 10000000, 0)),
  'past the allowance, purchased credit is drawn');
select pg_temp.expect(
  (select sum(delta_nanos) from public.ai_credit_ledger where org_id = 'a0000000-0000-4000-8000-0000000000aa') = 38000000,
  'the credit ledger shows the draw');

-- Re-pricing legacy Gemini rows: billed = tokens × official rate × 10.
-- Token counts are real production rows; old amounts are what they stored.
insert into public.token_usage_events
  (org_id, request_id, feature, source, model_id, input_tokens, output_tokens, cost_nanos, price_nanos, pricing_status, metadata, created_at)
values
  ('b0000000-0000-4000-8000-0000000000bb', 't06-g1', 'ask', 'proof_ask', 'gemini-3.5-flash-lite', 1985, 250, 298500, 2985000, 'legacy', '{"customerMarkup":10}', '2031-01-06Z'),
  ('b0000000-0000-4000-8000-0000000000bb', 't06-g2', 'video_analysis', 'video_analysis', 'gemini-3.6-flash', 1357, 132, 189000, 1890000, 'legacy', '{}', '2031-01-06Z'),
  ('b0000000-0000-4000-8000-0000000000bb', 't06-g3', 'other', 'tavily', 'tavily-search', 0, 0, 8000000, 80000000, 'legacy', '{"customerMarkup":10}', '2031-01-06Z');
\i :migration
\i :migration
select pg_temp.expect(
  (select cost_nanos = 1220500 and price_nanos = 12205000 and pricing_status = 'repriced_conservative'
     and (metadata->'repricing'->>'previousPriceNanos')::bigint = 2985000
     from public.token_usage_events where request_id = 't06-g1'),
  'gemini-3.5-flash-lite 1,985 in / 250 out = ($0.30, $2.50 per MTok) × 10 = $0.012205');
select pg_temp.expect(
  (select cost_nanos = 1512750 and price_nanos = 15127500 and pricing_status = 'repriced_conservative'
     from public.token_usage_events where request_id = 't06-g2'),
  'gemini-3.6-flash 1,357 in / 132 out = ($0.75, $3.75 per MTok) × 10 = $0.0151275');
select pg_temp.expect(
  (select cost_nanos = 8000000 and price_nanos = 80000000 and feature = 'web_search'
     from public.token_usage_events where request_id = 't06-g3'),
  'Tavily basic search = 1 credit × $0.008 × 10 = $0.08, on the Web search line');
select pg_temp.expect(
  (select price_nanos = 525000000 from public.token_usage_events where request_id = 't06-1')
  and (select price_nanos = 11250000 from public.token_usage_events where request_id = 't06-5'),
  'rows already priced at the official rate keep their amounts');

rollback;
SQL
echo "==> 06 token usage screens agree: all assertions passed"
