-- Contractor payments (Stripe Connect) and proof-backed invoices.
--
-- PROD NOTE: merging the PR that carries this file auto-applies it to the
-- production database. It only creates new tables; it changes no existing
-- table, row or policy.
--
-- Money model: separate charges and transfers (proof-based release). The
-- homeowner pays the whole invoice to Atmosphere's platform account
-- (on_behalf_of the contractor's Express account, one transfer_group per
-- invoice). Funds are held per line; when the GC confirms a line (after the
-- AI marks it verified from the job's video analysis) the BFF creates a
-- Transfer of that line, less Atmosphere's fee, to the connected account. All rows are written by the BFF (service role) after it
-- checks the caller; workspace members can read their workspace's rows.
-- Homeowners never read these tables directly: the server returns their
-- invoices with contractor-private fields (fee, internal notes, Stripe ids)
-- removed and evidence filtered by the job's homeowner permissions.

-- One connected account per workspace, onboarded by the owner from Billing.
create table if not exists public.org_payment_accounts (
  org_id             uuid primary key references public.orgs (id) on delete cascade,
  stripe_account_id  text not null unique,
  livemode           boolean not null default false,
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  details_submitted  boolean not null default false,
  requirements_due   text[] not null default '{}',
  -- Company setting: release a line on AI verification alone. Off by default;
  -- today every release needs a GC (owner/admin) confirmation.
  allow_ai_release   boolean not null default false,
  -- Last payout event from the connected account (Connect webhook).
  last_payout_status text,
  last_payout_at     timestamptz,
  deauthorized_at    timestamptz,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.org_payment_accounts is
  'Stripe Connect account that receives homeowner payments for one workspace. Written by the BFF (service role).';

-- An invoice on a job file. Lines carry the proof that backs them.
create table if not exists public.job_invoices (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs (id) on delete cascade,
  job_id               uuid not null references public.crm_jobs (id) on delete cascade,
  number               integer not null,
  title                text not null check (char_length(title) between 1 and 200),
  kind                 text not null default 'invoice' check (kind in ('invoice', 'deductible', 'out_of_pocket')),
  status               text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  currency             text not null default 'usd' check (currency = 'usd'),
  total_cents          bigint not null default 0 check (total_cents >= 0),
  homeowner_note       text check (homeowner_note is null or char_length(homeowner_note) <= 2000),
  internal_note        text check (internal_note is null or char_length(internal_note) <= 2000),
  created_by           uuid references public.profiles (id) on delete set null,
  sent_at              timestamptz,
  paid_at              timestamptz,
  voided_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (job_id, number)
);

create index if not exists job_invoices_org_idx on public.job_invoices (org_id);
create index if not exists job_invoices_job_idx on public.job_invoices (job_id);

create table if not exists public.job_invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references public.job_invoices (id) on delete cascade,
  org_id        uuid not null references public.orgs (id) on delete cascade,
  job_id        uuid not null references public.crm_jobs (id) on delete cascade,
  position      integer not null default 0,
  description   text not null check (char_length(description) between 1 and 500),
  quantity      numeric(12, 2) not null default 1 check (quantity > 0),
  unit_cents    bigint not null check (unit_cents >= 0),
  amount_cents  bigint not null check (amount_cents >= 0),
  -- [{ "proofId": uuid, "atSeconds": number|null, "quote": text|null }]
  evidence      jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  -- The scope item this line bills for (verification checks the clips against it).
  scope_item_id uuid references public.job_scope_items (id) on delete set null,
  -- unpaid -> held (homeowner paid) -> verified (AI) -> released (Transfer made)
  -- frozen: charge disputed, release blocked. refunded: held money returned to
  -- the homeowner. reversed: released, then pulled back (Transfer reversal).
  release_status text not null default 'unpaid'
    check (release_status in ('unpaid', 'held', 'verified', 'released', 'frozen', 'refunded', 'reversed')),
  refunded_cents bigint not null default 0 check (refunded_cents >= 0),
  reversed_cents bigint not null default 0 check (reversed_cents >= 0),
  stripe_reversal_id text,
  dispute_flag  boolean not null default false,
  held_alerted_at timestamptz,
  held_at       timestamptz,
  ai_verdict    jsonb,
  ai_verified_at timestamptz,
  released_at   timestamptz,
  released_by   uuid references public.profiles (id) on delete set null,
  release_mode  text check (release_mode is null or release_mode in ('gc_confirmed', 'ai_auto')),
  release_cents bigint check (release_cents is null or release_cents >= 0),
  stripe_transfer_id text unique,
  created_at    timestamptz not null default now()
);

create index if not exists job_invoice_lines_invoice_idx on public.job_invoice_lines (invoice_id, position);
create index if not exists job_invoice_lines_org_idx on public.job_invoice_lines (org_id);

-- Every payment attempt on a job (Checkout session), updated by webhooks.
create table if not exists public.job_payments (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.orgs (id) on delete cascade,
  job_id                      uuid not null references public.crm_jobs (id) on delete cascade,
  invoice_id                  uuid references public.job_invoices (id) on delete set null,
  stripe_account_id           text not null,
  amount_cents                bigint not null check (amount_cents > 0),
  application_fee_cents       bigint not null default 0 check (application_fee_cents >= 0),
  currency                    text not null default 'usd',
  status                      text not null default 'pending'
                                check (status in ('pending', 'processing', 'paid', 'failed', 'expired', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost')),
  refunded_cents              bigint not null default 0 check (refunded_cents >= 0),
  stripe_dispute_id           text,
  dispute_status              text,
  disputed_at                 timestamptz,
  method                      text,
  livemode                    boolean not null default false,
  stripe_checkout_session_id  text unique,
  stripe_payment_intent_id    text,
  stripe_charge_id            text,
  transfer_group              text,
  payer_user_id               uuid references public.profiles (id) on delete set null,
  payer_email                 text,
  paid_at                     timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists job_payments_org_idx on public.job_payments (org_id);
create index if not exists job_payments_job_idx on public.job_payments (job_id, created_at desc);
create index if not exists job_payments_invoice_idx on public.job_payments (invoice_id);
create index if not exists job_payments_pi_idx on public.job_payments (stripe_payment_intent_id);

do $$
declare t text;
begin
  foreach t in array array['org_payment_accounts', 'job_invoices', 'job_invoice_lines', 'job_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_org_member(org_id))',
      t || '_select', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
