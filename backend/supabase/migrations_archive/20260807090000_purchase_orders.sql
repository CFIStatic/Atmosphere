-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
-- The estimate says what work a job needs; this says what to buy for it. A
-- purchase order starts as a materials takeoff from an estimate — drywall
-- square feet become sheets, baseboard feet become sticks — and moves through
-- exactly one gate before any money moves: a person approves it.
--
-- The status machine is enforced here rather than in route code because the
-- one thing this feature must never do is order material nobody signed off on.
-- An API bug can skip a check in TypeScript; it cannot skip a trigger.
--
--   draft ──────► approved ──────► placed
--     │              │  ▲
--     │              │  └── reopen (approval withdrawn, stamps cleared)
--     ▼              ▼
--  cancelled     cancelled          placed is terminal.
--
-- Lines freeze the moment the order leaves draft: what was approved is what
-- gets ordered, and an order whose contents changed after approval was never
-- really approved at all.

create table if not exists public.purchase_orders (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs (id) on delete cascade,
  created_by        uuid references public.profiles (id) on delete set null,

  -- Where the quantities came from. The estimate may be pruned later, so the
  -- names are denormalised: a placed order must stay legible on its own.
  estimate_id       uuid references public.estimator_estimates (id) on delete set null,
  job_name          text not null check (length(btrim(job_name)) between 1 and 200),
  claim_number      text,

  -- 'home_depot' | 'lowes' go through a connected API when one exists;
  -- 'manual' is ordering anywhere else and recording the reference here.
  supplier          text not null check (supplier in ('home_depot', 'lowes', 'manual')),
  -- The supplier as a CRM account (type 'vendor'), so what the org spends with
  -- them lives in the same account system as everything else.
  vendor_account_id uuid references public.crm_accounts (id) on delete set null,

  status            text not null default 'draft'
                      check (status in ('draft', 'approved', 'placed', 'cancelled')),

  -- The approval gate. Checks, not conventions: an approved or placed order
  -- without a named approver cannot exist.
  approved_by       uuid references public.profiles (id) on delete set null,
  approved_at       timestamptz,
  constraint po_approved_has_approver
    check (status not in ('approved', 'placed')
           or (approved_by is not null and approved_at is not null)),

  placed_at         timestamptz,
  -- The supplier's order number, or whatever reference a manual order has.
  external_ref      text,
  constraint po_placed_has_timestamp
    check (status <> 'placed' or placed_at is not null),

  note              text check (note is null or length(note) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists purchase_orders_org_idx
  on public.purchase_orders (org_id, created_at desc);

comment on table public.purchase_orders is
  'Materials orders sourced from estimates. draft -> approved -> placed, '
  'enforced by trigger; nothing is ever placed without a named approver.';

-- The transition table, as a trigger. Everything not listed is refused —
-- including edits to a placed order's substance, which is a record of what
-- was bought, not a working document.
create or replace function private.purchase_order_transition()
returns trigger
language plpgsql
as $$
begin
  if old.status = new.status then
    -- Same-status edits: fine in draft, refused once placed or cancelled.
    -- (Approved orders allow metadata edits like external_ref, but their
    -- lines are frozen by the line trigger below.)
    if old.status in ('placed', 'cancelled')
       and (new.supplier, new.job_name, new.note, new.external_ref)
           is distinct from (old.supplier, old.job_name, old.note, old.external_ref) then
      raise exception 'A % order is a record. It cannot be edited.', old.status;
    end if;
    return new;
  end if;

  if not (
    (old.status = 'draft'    and new.status in ('approved', 'cancelled')) or
    (old.status = 'approved' and new.status in ('placed', 'draft', 'cancelled'))
  ) then
    raise exception 'A purchase order cannot go from % to %.', old.status, new.status;
  end if;

  -- Withdrawing approval clears the stamps — a reopened draft carries no
  -- residue of a signature that no longer stands.
  if old.status = 'approved' and new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists purchase_orders_transitions on public.purchase_orders;
create trigger purchase_orders_transitions
  before update on public.purchase_orders
  for each row execute function private.purchase_order_transition();

drop trigger if exists purchase_orders_touch on public.purchase_orders;
create trigger purchase_orders_touch
  before update on public.purchase_orders
  for each row execute function public.touch_updated_at();

alter table public.purchase_orders enable row level security;

drop policy if exists purchase_orders_select on public.purchase_orders;
create policy purchase_orders_select on public.purchase_orders
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists purchase_orders_insert on public.purchase_orders;
create policy purchase_orders_insert on public.purchase_orders
  for insert to authenticated with check (private.is_org_member(org_id));

drop policy if exists purchase_orders_update on public.purchase_orders;
create policy purchase_orders_update on public.purchase_orders
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Lines
-- ---------------------------------------------------------------------------
-- One orderable thing each: "13 sheets of 1/2 in drywall", with the estimate
-- lines it was computed from kept alongside so an approver can ask "why 13".
-- unit_price is an estimate from catalog figures until a supplier quotes it,
-- and price_basis says which one you are looking at — the same honesty rule
-- as the estimator's priceVerified flag.

create table if not exists public.purchase_order_lines (
  id             uuid primary key default gen_random_uuid(),
  po_id          uuid not null references public.purchase_orders (id) on delete cascade,
  org_id         uuid not null references public.orgs (id) on delete cascade,

  material_key   text not null,
  description    text not null check (length(btrim(description)) between 1 and 300),
  -- The pack a person recognises in an aisle: '4 x 8 ft sheet, 1/2 in'.
  detail         text,

  quantity       numeric(10, 2) not null check (quantity > 0),
  unit           text not null,

  unit_price     numeric(10, 2) check (unit_price is null or unit_price >= 0),
  price_basis    text not null default 'estimate'
                   check (price_basis in ('estimate', 'quoted')),

  -- Which estimate work lines this material serves, in words.
  source_summary text,
  position       int not null default 0
);

create index if not exists purchase_order_lines_po_idx
  on public.purchase_order_lines (po_id, position);

-- Frozen outside draft. The check runs on the parent's *current* status, so
-- approving an order seals its contents in the same statement order every
-- code path must respect.
create or replace function private.purchase_order_lines_frozen()
returns trigger
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.purchase_orders
   where id = coalesce(new.po_id, old.po_id);

  -- Deleting lines under a cascade (parent row already gone) is allowed.
  if v_status is null then
    return coalesce(new, old);
  end if;

  if v_status <> 'draft' then
    raise exception
      'This order is %. Its lines are what was approved — reopen it to draft to change them.',
      v_status;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists purchase_order_lines_freeze on public.purchase_order_lines;
create trigger purchase_order_lines_freeze
  before insert or update or delete on public.purchase_order_lines
  for each row execute function private.purchase_order_lines_frozen();

alter table public.purchase_order_lines enable row level security;

drop policy if exists purchase_order_lines_select on public.purchase_order_lines;
create policy purchase_order_lines_select on public.purchase_order_lines
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists purchase_order_lines_write on public.purchase_order_lines;
create policy purchase_order_lines_write on public.purchase_order_lines
  for all to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
-- Who created it, who approved it, who placed it, and when — append-only for
-- the same reason the evidence custody log is: a history that can be edited
-- is not a history.

create table if not exists public.purchase_order_events (
  id       uuid primary key default gen_random_uuid(),
  po_id    uuid not null references public.purchase_orders (id) on delete cascade,
  org_id   uuid not null references public.orgs (id) on delete cascade,
  actor    uuid references public.profiles (id) on delete set null,
  action   text not null check (action in
             ('created', 'edited', 'approved', 'reopened', 'placed', 'cancelled')),
  detail   text not null default '',
  at       timestamptz not null default now()
);

create index if not exists purchase_order_events_po_idx
  on public.purchase_order_events (po_id, at);

create or replace function private.purchase_order_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Order history cannot be edited or deleted.';
end;
$$;

drop trigger if exists purchase_order_events_immutable on public.purchase_order_events;
create trigger purchase_order_events_immutable
  before update or delete on public.purchase_order_events
  for each row execute function private.purchase_order_events_append_only();

alter table public.purchase_order_events enable row level security;

drop policy if exists purchase_order_events_select on public.purchase_order_events;
create policy purchase_order_events_select on public.purchase_order_events
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists purchase_order_events_insert on public.purchase_order_events;
create policy purchase_order_events_insert on public.purchase_order_events
  for insert to authenticated with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Supplier connections
-- ---------------------------------------------------------------------------
-- Same construction as crm_oauth_grants, and for the same reason: a supplier
-- API credential belongs to one org and has to be stored, so it is sealed
-- with AES-256-GCM before it arrives and the key lives only in the server's
-- environment. The payload is a JSON object of whatever fields the supplier's
-- API turns out to need — the shape is the adapter's business, not the
-- schema's, because Home Depot's contract and Lowe's contract will not match.

create table if not exists public.supplier_connections (
  org_id        uuid not null references public.orgs (id) on delete cascade,
  supplier      text not null check (supplier in ('home_depot', 'lowes')),

  iv            text not null,
  tag           text not null,
  ciphertext    text not null,

  account_label text,
  connected_by  uuid references public.profiles (id) on delete set null,
  connected_at  timestamptz not null default now(),

  primary key (org_id, supplier)
);

comment on table public.supplier_connections is
  'Sealed supplier API credentials. Ciphertext only; the key lives in '
  'INTEGRATIONS_OAUTH_KEY, never here. Service-role access only.';

alter table public.supplier_connections enable row level security;

-- No policy grants anything to authenticated: connection status reaches the
-- UI through an endpoint that reads with the service role and returns only
-- the label and the date, never the envelope.
drop policy if exists supplier_connections_no_user_access on public.supplier_connections;
create policy supplier_connections_no_user_access on public.supplier_connections
  for select using (false);

revoke all on public.purchase_orders, public.purchase_order_lines,
              public.purchase_order_events, public.supplier_connections
  from anon;
