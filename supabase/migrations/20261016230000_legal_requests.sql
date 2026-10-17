-- Inbound legal requests (legal@atmosphereteam.com).
--
-- A Cloudflare Email Worker forwards every message to the founder and POSTs a
-- copy to POST /api/legal/inbound, authenticated by LEGAL_INBOUND_SECRET.
-- Each message becomes one row here so holds, preservation and takedown
-- requests have a record and a response clock.
--
-- Staff-only: RLS on with no policies, and only service_role may touch it,
-- matching public.legal_holds.

create table if not exists public.legal_requests (
  id uuid primary key default gen_random_uuid(),
  message_id text,
  from_address text not null check (length(from_address) between 1 and 320),
  from_name text check (from_name is null or length(from_name) <= 320),
  to_address text check (to_address is null or length(to_address) <= 320),
  subject text check (subject is null or length(subject) <= 998),
  text_body text check (text_body is null or length(text_body) <= 200000),
  attachments jsonb not null default '[]'::jsonb,
  raw_size integer check (raw_size is null or raw_size >= 0),
  received_at timestamp with time zone not null default now(),
  status text not null default 'new'
    check (status in ('new', 'acknowledged', 'hold_placed', 'closed', 'rejected')),
  legal_hold_id uuid references public.legal_holds(id) on delete set null,
  notes text check (notes is null or length(notes) <= 4000),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- One row per email even if the Worker retries.
create unique index if not exists legal_requests_message_id_key
  on public.legal_requests (message_id) where message_id is not null;
create index if not exists legal_requests_received_at_idx
  on public.legal_requests (received_at desc);

alter table public.legal_requests enable row level security;

revoke all on public.legal_requests from public, anon, authenticated;
grant select, insert, update, delete on public.legal_requests to service_role;
