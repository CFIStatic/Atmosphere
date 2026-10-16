-- ---------------------------------------------------------------------------
-- Real-time / near-real-time Field Capture safety incidents + org policy
-- ---------------------------------------------------------------------------
-- Detect emergencies while a day film is recording or shortly after a segment
-- lands (fall / person down, violence, verbal threats, medical distress).
-- Persist an incident, alert the org, and let Platform ack/dismiss.
--
-- Authorities escalation is NEVER automatic by default. The org setting
-- auto_escalate_to_authorities defaults to false. Even when true, Atmosphere
-- only sets recommended_action / payload flags — it does not call 911 or
-- police APIs. See docs/safety-alerts.md.

do $$ begin
  create type public.safety_incident_category as enum (
    'fall_person_down',
    'physical_violence',
    'verbal_threat',
    'medical_distress',
    'other_emergency'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.safety_incident_severity as enum ('watch', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.safety_incident_status as enum (
    'open',
    'acknowledged',
    'dismissed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.safety_recommended_action as enum (
    'monitor',
    'dispatch_help',
    'contact_authorities'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.safety_incident_source as enum (
    'live_sample',
    'upload_chunk',
    'post_upload',
    'transcript'
  );
exception when duplicate_object then null; end $$;

alter table public.orgs
  add column if not exists safety_auto_escalate_to_authorities boolean not null default false,
  add column if not exists safety_alert_webhook_url text
    check (safety_alert_webhook_url is null or length(safety_alert_webhook_url) between 8 and 2000),
  add column if not exists safety_alert_emails text[] not null default '{}';

comment on column public.orgs.safety_auto_escalate_to_authorities is
  'When true, critical incidents with recommended_action=contact_authorities '
  'include escalateToAuthorities=true in alert payloads. Atmosphere never calls '
  '911/police APIs itself. Default false. Prefer human confirm before enabling.';

comment on column public.orgs.safety_alert_webhook_url is
  'Optional HTTPS webhook for safety incident fanout (JSON POST).';

comment on column public.orgs.safety_alert_emails is
  'Extra alert recipients beyond org global_admins. Empty = admins only.';

create table if not exists public.safety_incidents (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.orgs (id) on delete cascade,
  job_id                    uuid references public.crm_jobs (id) on delete set null,
  party_id                  uuid,
  proof_id                  uuid references public.job_proofs (id) on delete set null,
  clip_id                   text,
  category                  public.safety_incident_category not null,
  severity                  public.safety_incident_severity not null,
  confidence                numeric(4,3) not null
    check (confidence >= 0 and confidence <= 1),
  title                     text not null check (length(title) between 1 and 200),
  description               text not null check (length(description) between 1 and 4000),
  clip_timestamp_seconds    numeric(12,3),
  lat                       double precision,
  lon                       double precision,
  location_label            text check (location_label is null or length(location_label) <= 400),
  recommended_action        public.safety_recommended_action not null default 'monitor',
  status                    public.safety_incident_status not null default 'open',
  source                    public.safety_incident_source not null,
  model                     text,
  signals                   jsonb not null default '{}'::jsonb,
  alert_sent_at             timestamptz,
  alert_channels            text[] not null default '{}',
  acknowledged_at           timestamptz,
  acknowledged_by           uuid references public.profiles (id) on delete set null,
  dismissed_at              timestamptz,
  dismissed_by              uuid references public.profiles (id) on delete set null,
  dismiss_reason            text check (dismiss_reason is null or length(dismiss_reason) <= 1000),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.safety_incidents is
  'Safety / emergency flags from Field Capture vision+audio chunk analysis. '
  'Operators ack or dismiss in Platform. Never auto-dial emergency services.';

create index if not exists safety_incidents_org_open_idx
  on public.safety_incidents (org_id, status, created_at desc)
  where status = 'open';

create index if not exists safety_incidents_job_idx
  on public.safety_incidents (job_id, created_at desc)
  where job_id is not null;

create index if not exists safety_incidents_proof_idx
  on public.safety_incidents (proof_id)
  where proof_id is not null;

create index if not exists safety_incidents_org_created_idx
  on public.safety_incidents (org_id, created_at desc);

-- Dedup / rate-limit helper: recent open incidents of same category on a job.
create index if not exists safety_incidents_rate_idx
  on public.safety_incidents (org_id, job_id, category, created_at desc);

alter table public.safety_incidents enable row level security;

drop policy if exists safety_incidents_select_member on public.safety_incidents;
create policy safety_incidents_select_member on public.safety_incidents
  for select to authenticated
  using (private.is_org_member(org_id));

-- Writes go through the BFF (service role). Authenticated clients may ack/dismiss
-- their own org's open incidents via RPC-less updates restricted below.
drop policy if exists safety_incidents_update_member on public.safety_incidents;
create policy safety_incidents_update_member on public.safety_incidents
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

grant select, update on public.safety_incidents to authenticated;
grant all on public.safety_incidents to service_role;

-- Org members may read their own safety policy columns (already on orgs select).
comment on column public.orgs.safety_auto_escalate_to_authorities is
  'Policy flag only — no 911 API. Default false. See docs/safety-alerts.md.';
