-- Audit trail for Computer supply orders (Home Depot first).
-- Never stores card numbers, passwords, or clip content. Idempotency uses order_key_hash.

create table if not exists public.computer_supply_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  task_id uuid,
  approval_id uuid,
  vendor text not null,
  status text not null
    check (status in ('draft', 'awaiting_approval', 'approved', 'placed', 'canceled', 'failed')),
  order_key_hash text not null,
  line_count integer not null default 0,
  subtotal_cents integer,
  currency text not null default 'USD',
  fulfillment_mode text,
  has_job_address boolean not null default false,
  low_confidence_count integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint computer_supply_orders_order_key_unique unique (org_id, task_id, order_key_hash)
);

create index if not exists computer_supply_orders_org_created_idx
  on public.computer_supply_orders (org_id, created_at desc);

create index if not exists computer_supply_orders_job_idx
  on public.computer_supply_orders (job_id);

comment on table public.computer_supply_orders is
  'Computer supply-order attempts (Home Depot etc.). No card numbers or secrets. order_key_hash blocks double Place Order.';

alter table public.computer_supply_orders enable row level security;

drop policy if exists computer_supply_orders_org_select on public.computer_supply_orders;
create policy computer_supply_orders_org_select
  on public.computer_supply_orders
  for select
  to authenticated
  using (private.is_org_member(org_id));

revoke insert, update, delete on public.computer_supply_orders from authenticated, anon;
grant select on public.computer_supply_orders to authenticated;

-- Per-line Approve: which cart lines the person checked (and quantities they typed),
-- with the fingerprint of exactly that order. No card data.
alter table public.computer_approvals
  add column if not exists approved_order jsonb;

comment on column public.computer_approvals.approved_order is
  'Supply carts: approved lines (sku, qty, qty source, line total), excluded lines, subtotal, and order fingerprint.';
