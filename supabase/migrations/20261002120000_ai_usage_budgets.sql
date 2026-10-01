-- AI usage allowance.
--
-- The included allowance resets each billing period and does not roll over.
-- Purchased credits and staff grants roll over until they are used, and they
-- are drawn only after the included allowance cannot cover a call.
-- Uploaded clips are never rejected for budget: ai_budget_hold means the file
-- is stored and analysis waits until allowance or credits are available.

create table if not exists public.ai_credit_ledger (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs (id) on delete cascade,
  delta_nanos       bigint not null,
  kind              text not null check (kind in ('purchase', 'admin_grant', 'consume', 'refund', 'adjustment')),
  stripe_event_id   text,
  stripe_session_id text,
  request_id        text,
  note              text,
  actor_id          uuid,
  created_at        timestamptz not null default now()
);

comment on table public.ai_credit_ledger is
  'Prepaid AI spend. Purchases and staff grants roll over until used. Consumes are negative. Idempotent on stripe_event_id and on (org_id, request_id).';

create unique index if not exists ai_credit_ledger_stripe_event_uidx
  on public.ai_credit_ledger (stripe_event_id)
  where stripe_event_id is not null;

create unique index if not exists ai_credit_ledger_request_uidx
  on public.ai_credit_ledger (org_id, request_id)
  where request_id is not null;

create index if not exists ai_credit_ledger_org_idx
  on public.ai_credit_ledger (org_id, created_at desc);

create table if not exists public.ai_usage_allocations (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  request_id      text not null,
  cost_nanos      bigint not null check (cost_nanos >= 0),
  allowance_nanos bigint not null check (allowance_nanos >= 0),
  credit_nanos    bigint not null check (credit_nanos >= 0),
  created_at      timestamptz not null default now(),
  unique (org_id, request_id)
);

comment on table public.ai_usage_allocations is
  'How one metered AI call was paid: included allowance first, then rollover credits. The rolling window sums allowance_nanos.';

create index if not exists ai_usage_allocations_org_created_idx
  on public.ai_usage_allocations (org_id, created_at desc);

create table if not exists public.ai_budget_price_spans (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  amount_cents     integer not null check (amount_cents >= 0),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  effective_from   timestamptz not null,
  effective_to     timestamptz,
  created_at       timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

comment on table public.ai_budget_price_spans is
  'Recurring subscription charge (plan plus extra seats) while it was in force. The period allowance prorates across spans when the price changes mid-period.';

create index if not exists ai_budget_price_spans_org_idx
  on public.ai_budget_price_spans (org_id, effective_from);

alter table public.job_proofs
  add column if not exists ai_budget_hold boolean not null default false,
  add column if not exists ai_budget_hold_reason text;

comment on column public.job_proofs.ai_budget_hold is
  'Clip is stored. AI reading waits until the allowance resets, the plan changes, or credits are purchased.';

create index if not exists job_proofs_ai_budget_hold_idx
  on public.job_proofs (org_id, received_at)
  where ai_budget_hold = true and deleted_at is null;

do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  where con.conrelid = 'public.scope_documents'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%uploaded%'
    and pg_get_constraintdef(con.oid) like '%extracting%'
    and pg_get_constraintdef(con.oid) not like '%budget_hold%';
  if cname is not null then
    execute format('alter table public.scope_documents drop constraint %I', cname);
  end if;
end $$;

alter table public.scope_documents
  drop constraint if exists scope_documents_status_check;

alter table public.scope_documents
  add constraint scope_documents_status_check
  check (status in ('uploaded', 'extracting', 'extracted', 'failed', 'confirmed', 'budget_hold'));

alter table public.ai_credit_ledger enable row level security;
alter table public.ai_usage_allocations enable row level security;
alter table public.ai_budget_price_spans enable row level security;

drop policy if exists ai_credit_ledger_select on public.ai_credit_ledger;
create policy ai_credit_ledger_select on public.ai_credit_ledger
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists ai_usage_allocations_select on public.ai_usage_allocations;
create policy ai_usage_allocations_select on public.ai_usage_allocations
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists ai_budget_price_spans_select on public.ai_budget_price_spans;
create policy ai_budget_price_spans_select on public.ai_budget_price_spans
  for select to authenticated
  using (private.is_org_member(org_id));

revoke all on public.ai_credit_ledger from public, anon;
revoke all on public.ai_usage_allocations from public, anon;
revoke all on public.ai_budget_price_spans from public, anon;
grant select on public.ai_credit_ledger to authenticated;
grant select on public.ai_usage_allocations to authenticated;
grant select on public.ai_budget_price_spans to authenticated;
grant all on public.ai_credit_ledger to service_role;
grant all on public.ai_usage_allocations to service_role;
grant all on public.ai_budget_price_spans to service_role;
