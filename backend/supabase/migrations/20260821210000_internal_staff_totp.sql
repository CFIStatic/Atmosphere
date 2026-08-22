-- Per-staff TOTP secrets for the internal site (Microsoft Authenticator).
-- Service role only — the browser never reads this table.

create table if not exists public.internal_staff_totp (
  email          text primary key,
  secret_cipher  text not null,
  secret_iv      text not null,
  secret_tag     text not null,
  enrolled_at    timestamptz not null default now(),
  last_counter   bigint not null default -1,
  updated_at     timestamptz not null default now()
);

alter table public.internal_staff_totp enable row level security;

revoke all on table public.internal_staff_totp from public, anon, authenticated;
grant all on table public.internal_staff_totp to service_role;
