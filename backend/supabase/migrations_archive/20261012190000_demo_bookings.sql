-- ============================================================================
-- Self-serve product demos booked from atmosphereteam.com/demo.
--
-- One row per booking. The partial unique index on slot_start is what makes
-- double booking impossible: two visitors racing for the same 30-minute slot
-- get one row and one 23505. Written only by the API with the service role;
-- RLS is on with no policies, so anon/authenticated clients cannot read it.
-- Safe to re-run.
-- ============================================================================

create table if not exists public.demo_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_start timestamptz not null,
  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  company text not null check (char_length(company) between 1 and 200),
  phone text check (phone is null or char_length(phone) <= 40),
  notes text check (notes is null or char_length(notes) <= 2000),
  guest_time_zone text check (guest_time_zone is null or char_length(guest_time_zone) <= 64),
  client_ip text check (client_ip is null or char_length(client_ip) <= 128),
  host_emailed_at timestamptz,
  guest_emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists demo_bookings_slot_booked_uniq
  on public.demo_bookings (slot_start)
  where status = 'booked';

alter table public.demo_bookings enable row level security;
revoke all on table public.demo_bookings from anon, authenticated;
