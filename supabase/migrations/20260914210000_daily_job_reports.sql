-- ---------------------------------------------------------------------------
-- Auto end-of-day Glance job reports (opt-in)
-- ---------------------------------------------------------------------------
-- When enabled, Atmosphere emails homeowner + PM a Glance-style summary of
-- that day's clips at the org's local end-of-day. Off by default. Respects
-- privacy redactions. See docs/daily-job-report.md.

alter table public.orgs
  add column if not exists daily_job_report_enabled boolean not null default false,
  add column if not exists daily_job_report_timezone text not null default 'America/New_York'
    check (length(btrim(daily_job_report_timezone)) between 1 and 64),
  add column if not exists daily_job_report_channel text not null default 'email'
    check (daily_job_report_channel in ('email', 'sms', 'email_and_sms')),
  add column if not exists daily_job_report_send_hour integer not null default 18
    check (daily_job_report_send_hour >= 0 and daily_job_report_send_hour <= 23),
  add column if not exists daily_job_report_extra_emails text[] not null default '{}';

comment on column public.orgs.daily_job_report_enabled is
  'Opt-in: when true, send end-of-day Glance summaries of that day''s clips to '
  'homeowner + PM. Default false.';

comment on column public.orgs.daily_job_report_timezone is
  'IANA timezone used for the org''s local calendar day and send hour.';

comment on column public.orgs.daily_job_report_channel is
  'Delivery preference. SMS is stored for preference; when no SMS provider is '
  'wired, email is used and SMS is skipped with a log line.';

comment on column public.orgs.daily_job_report_send_hour is
  'Local hour (0-23) after which the EOD report may fire for that local day.';

comment on column public.orgs.daily_job_report_extra_emails is
  'Optional extra recipients beyond homeowner + PM resolution.';

do $$ begin
  create type public.daily_job_report_status as enum (
    'pending',
    'sent',
    'skipped',
    'failed'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.daily_job_reports (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  job_id             uuid not null references public.crm_jobs (id) on delete cascade,
  local_day          date not null,
  timezone           text not null,
  channel            text not null default 'email'
    check (channel in ('email', 'sms', 'email_and_sms')),
  status             public.daily_job_report_status not null default 'pending',
  recipient_emails   text[] not null default '{}',
  recipient_phones   text[] not null default '{}',
  subject            text,
  body_text          text,
  body_html          text,
  summary            jsonb not null default '{}'::jsonb,
  clip_count         integer not null default 0 check (clip_count >= 0),
  error              text,
  sent_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, job_id, local_day)
);

comment on table public.daily_job_reports is
  'Idempotent per-job local-day Glance reports. One row per (org, job, day).';

create index if not exists daily_job_reports_org_day_idx
  on public.daily_job_reports (org_id, local_day desc);

create index if not exists daily_job_reports_status_idx
  on public.daily_job_reports (status, created_at)
  where status in ('pending', 'failed');

alter table public.daily_job_reports enable row level security;

drop policy if exists daily_job_reports_select_member on public.daily_job_reports;
create policy daily_job_reports_select_member on public.daily_job_reports
  for select to authenticated
  using (private.is_org_member(org_id));

grant select on public.daily_job_reports to authenticated;
grant all on public.daily_job_reports to service_role;
