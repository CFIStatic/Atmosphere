-- Person service role titles for Analysis labeling ("Alex — Electrician",
-- "Homeowner"). Distinct from org_members.role (seat / product role).
--
-- Canonical: profiles.service_role (+ optional custom when other).
-- Job override: job_parties.service_role when set for that job.
-- Homeowner grants always resolve to Homeowner (column records the forced slug).
-- Org invites may suggest a title at signup (advisory).

alter table public.profiles
  add column if not exists service_role text
    check (
      service_role is null
      or service_role in (
        'homeowner',
        'adjuster',
        'estimator',
        'project_manager',
        'electrician',
        'plumber',
        'roofer',
        'technician',
        'crew',
        'inspector',
        'other'
      )
    );

alter table public.profiles
  add column if not exists service_role_custom text
    check (
      service_role_custom is null
      or length(btrim(service_role_custom)) between 1 and 60
    );

comment on column public.profiles.service_role is
  'Person service title slug for Analysis (plumber, adjuster, homeowner, …). Not org seat role.';
comment on column public.profiles.service_role_custom is
  'Free-text title when service_role = other.';

-- Authenticated users may update their own title (profiles_self RLS).
grant update (full_name, avatar_url, email, service_role, service_role_custom)
  on public.profiles to authenticated;

alter table public.job_parties
  add column if not exists service_role text
    check (
      service_role is null
      or service_role in (
        'homeowner',
        'adjuster',
        'estimator',
        'project_manager',
        'electrician',
        'plumber',
        'roofer',
        'technician',
        'crew',
        'inspector',
        'other'
      )
    );

alter table public.job_parties
  add column if not exists service_role_custom text
    check (
      service_role_custom is null
      or length(btrim(service_role_custom)) between 1 and 60
    );

comment on column public.job_parties.service_role is
  'Optional per-job service title override; wins over profiles.service_role for this job.';
comment on column public.job_parties.service_role_custom is
  'Free-text job title when service_role = other.';

alter table public.job_progress_grants
  add column if not exists service_role text not null default 'homeowner'
    check (service_role = 'homeowner');

comment on column public.job_progress_grants.service_role is
  'Always homeowner — progress grants are homeowner/viewer job-file access.';

alter table public.org_invites
  add column if not exists service_role text
    check (
      service_role is null
      or service_role in (
        'homeowner',
        'adjuster',
        'estimator',
        'project_manager',
        'electrician',
        'plumber',
        'roofer',
        'technician',
        'crew',
        'inspector',
        'other'
      )
    );

alter table public.org_invites
  add column if not exists service_role_custom text
    check (
      service_role_custom is null
      or length(btrim(service_role_custom)) between 1 and 60
    );

comment on column public.org_invites.service_role is
  'Advisory person service title suggested at invite; joiner may change in settings.';
comment on column public.org_invites.service_role_custom is
  'Free-text suggested title when service_role = other.';
