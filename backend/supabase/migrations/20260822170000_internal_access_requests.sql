-- Employees request access to Internal Growth Metrics; an internal admin
-- approves (or denies) from the staff site. Service role only — the browser
-- never reads this table. Granting still writes analytics_staff.

create table if not exists public.internal_access_requests (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  first_name        text not null,
  last_name         text not null,
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'denied')),
  requested_at      timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid references auth.users(id) on delete set null,
  user_id           uuid references auth.users(id) on delete set null
);

create unique index if not exists internal_access_requests_email_key
  on public.internal_access_requests (lower(email));

create index if not exists internal_access_requests_status_idx
  on public.internal_access_requests (status, last_requested_at desc);

alter table public.internal_access_requests enable row level security;

revoke all on table public.internal_access_requests from public, anon, authenticated;
grant all on table public.internal_access_requests to service_role;
