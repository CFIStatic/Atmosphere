-- ============================================================================
-- Cyber Defense Agent (optional persistence)
-- ============================================================================
-- The agent keeps its live blocklist and event ring in process memory so defense
-- still works when Postgres is unreachable. These tables are an optional
-- archive for operators who want history across restarts. Nothing in the hot
-- path requires them.
--
-- Platform-scoped (no org_id): this watches the Atmosphere BFF itself, not a
-- single tenant's CRM data. Authenticated members may read; only the service
-- role may write, matching how the in-process agent would sync if wired later.
-- ============================================================================

create table if not exists public.cyber_security_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  ip text not null,
  method text not null,
  path text not null,
  user_agent text,
  score integer not null check (score >= 0 and score <= 100),
  severity text not null check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  action text not null check (action in ('observe', 'deceive', 'throttle', 'block', 'patch')),
  blocked boolean not null default false,
  decoy text,
  request_id text,
  signals jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cyber_security_events_at_idx
  on public.cyber_security_events (at desc);

create index if not exists cyber_security_events_ip_idx
  on public.cyber_security_events (ip, at desc);

create table if not exists public.cyber_ip_blocks (
  ip text primary key,
  reason text not null,
  score integer not null check (score >= 0 and score <= 100),
  severity text not null check (severity in ('info', 'low', 'medium', 'high', 'critical')),
  blocked_at timestamptz not null default now(),
  expires_at timestamptz,
  hits integer not null default 1 check (hits >= 0),
  last_seen_at timestamptz not null default now(),
  deceived boolean not null default false
);

create index if not exists cyber_ip_blocks_expires_idx
  on public.cyber_ip_blocks (expires_at);

create table if not exists public.cyber_patches (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  kind text not null check (kind in ('headers', 'config', 'blocklist', 'deception', 'runtime')),
  title text not null,
  detail text not null,
  applied boolean not null default false,
  residual_risk text
);

create index if not exists cyber_patches_at_idx
  on public.cyber_patches (at desc);

alter table public.cyber_security_events enable row level security;
alter table public.cyber_ip_blocks enable row level security;
alter table public.cyber_patches enable row level security;

-- Authenticated operators can read the archive; writes stay service-role only
-- (no insert/update/delete policies for authenticated / anon).
drop policy if exists cyber_security_events_select on public.cyber_security_events;
create policy cyber_security_events_select
  on public.cyber_security_events
  for select
  to authenticated
  using (true);

drop policy if exists cyber_ip_blocks_select on public.cyber_ip_blocks;
create policy cyber_ip_blocks_select
  on public.cyber_ip_blocks
  for select
  to authenticated
  using (true);

drop policy if exists cyber_patches_select on public.cyber_patches;
create policy cyber_patches_select
  on public.cyber_patches
  for select
  to authenticated
  using (true);

grant select on public.cyber_security_events to authenticated;
grant select on public.cyber_ip_blocks to authenticated;
grant select on public.cyber_patches to authenticated;
