-- Staff support access ("Open account" from Atmosphere Analytics).
--
-- One row per time-limited support session in which an Analytics staff member
-- views Platform as one specific customer user. The row is the audit record:
-- who opened it, for which user and workspace, why, when it was entered, when
-- it ended and how. Only the server (service role) reads or writes it; there
-- are no policies, so user tokens see nothing.
--
-- handoff_* columns hold a one-time code (sha256 only) and the encrypted
-- session token for the few minutes between "Open account" in Analytics and
-- the new Platform tab redeeming it; they are cleared on redemption.

create table if not exists public.staff_support_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null,
  staff_email text,
  target_user_id uuid not null,
  target_email text,
  org_id uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  handoff_hash text unique,
  handoff_expires_at timestamptz,
  handoff_token_enc text,
  cookie_hash text unique,
  entered_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  blocked_actions integer not null default 0
);

create index if not exists staff_support_sessions_org_idx
  on public.staff_support_sessions (org_id, created_at desc);
create index if not exists staff_support_sessions_staff_idx
  on public.staff_support_sessions (staff_user_id, created_at desc);

alter table public.staff_support_sessions enable row level security;
revoke all on public.staff_support_sessions from anon, authenticated;
