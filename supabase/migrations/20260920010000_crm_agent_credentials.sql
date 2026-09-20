-- ============================================================================
-- CRM agent credentials — org username/password for Connect CRM
-- ============================================================================
-- Atmosphere agents sign into JobNimbus, AccuLynx, Salesforce, and ServiceTitan
-- with the customer's own login. Passwords are AES-256-GCM sealed before insert
-- (cipher / iv / tag columns only). Username is stored plaintext so the UI can
-- show who is connected without decrypting. Deny-all RLS: members never SELECT
-- this table; the BFF (service role) is the only reader/writer.
--
-- Safe to re-run.
-- ============================================================================

create table if not exists public.crm_agent_credentials (
  org_id              uuid not null references public.orgs (id) on delete cascade,
  system              text not null
                        check (system in ('jobnimbus', 'acculynx', 'salesforce', 'servicetitan')),
  username            text not null check (length(btrim(username)) between 1 and 320),
  password_cipher     text not null,
  password_iv         text not null,
  password_tag        text not null,
  notes               text check (notes is null or length(notes) <= 2000),
  status              text not null default 'connected'
                        check (status in ('connected', 'pending_verify', 'error')),
  last_verified_at    timestamptz,
  last_error          text,
  last_agent_job_id   uuid,
  connected_by        uuid references public.profiles (id) on delete set null,
  connected_at        timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  primary key (org_id, system)
);

comment on table public.crm_agent_credentials is
  'Sealed CRM login credentials for agent session pull/push. '
  'Passwords never leave ciphertext columns; deny-all RLS.';

comment on column public.crm_agent_credentials.username is
  'Login username or email shown in Connect CRM; never a secret by itself.';

comment on column public.crm_agent_credentials.last_error is
  'Safe status text for operators. Must never contain the password.';

alter table public.crm_agent_credentials enable row level security;

drop policy if exists crm_agent_credentials_no_user_access on public.crm_agent_credentials;
create policy crm_agent_credentials_no_user_access on public.crm_agent_credentials
  for select to authenticated using (false);

revoke all on public.crm_agent_credentials from anon, authenticated;

-- Lightweight agent job queue (verify login / pull / push). Payload never
-- stores plaintext passwords — adapters decrypt from crm_agent_credentials.
create table if not exists public.crm_agent_jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  system          text not null
                    check (system in ('jobnimbus', 'acculynx', 'salesforce', 'servicetitan')),
  kind            text not null
                    check (kind in ('verify_login', 'pull', 'push_update', 'search')),
  status          text not null default 'queued'
                    check (status in ('queued', 'running', 'succeeded', 'failed')),
  request_summary jsonb,
  result_summary  jsonb,
  error           text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz
);

create index if not exists crm_agent_jobs_org_queued_idx
  on public.crm_agent_jobs (org_id, status, created_at)
  where status in ('queued', 'running');

create index if not exists crm_agent_jobs_org_system_idx
  on public.crm_agent_jobs (org_id, system, created_at desc);

comment on table public.crm_agent_jobs is
  'Agent work queue for CRM login sessions. No plaintext secrets in payloads.';

alter table public.crm_agent_jobs enable row level security;

drop policy if exists crm_agent_jobs_select on public.crm_agent_jobs;
create policy crm_agent_jobs_select on public.crm_agent_jobs
  for select to authenticated
  using (private.is_org_member(org_id));

revoke all on public.crm_agent_jobs from anon;
grant select on public.crm_agent_jobs to authenticated;
