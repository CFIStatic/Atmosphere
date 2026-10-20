-- Training data capture: people rate and fix clip summaries, and a workspace
-- decides whether its corrections may train Atmosphere's own AI.
--
-- 1. clip_summary_feedback. One row per person per clip: thumbs up / down on
--    the clip's AI summary, an optional reason, and an optional corrected
--    version in the person's own words. The AI text and model are copied in at
--    the time of rating, so a later re-analysis does not orphan the pair. The
--    clip's own summary is never changed (job_proofs stays server-only and the
--    AI text stays the evidence record).
--
-- 2. org_ai_training_settings. Off unless a Global Admin turns on "Help improve
--    Atmosphere's AI". Only workspaces with it on are read by the training-set
--    export (backend/scripts/exportTrainingSet.ts); nothing else reads it.
--
-- Both tables are written only by the server (service role) after it checks
-- the caller, as with the other evidence records since
-- 20261019150000_video_records_server_only.sql. Members can read their
-- workspace's rows.

create table if not exists public.clip_summary_feedback (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs (id) on delete cascade,
  job_id         uuid not null references public.crm_jobs (id) on delete cascade,
  proof_id       uuid not null references public.job_proofs (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  rating         smallint not null check (rating in (-1, 1)),
  reason         text check (reason is null or reason in ('wrong', 'missing', 'made_up', 'unclear', 'other')),
  ai_text        text not null check (length(ai_text) <= 8000),
  ai_model       text,
  corrected_text text check (corrected_text is null or length(corrected_text) between 1 and 4000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint clip_summary_feedback_one_per_person unique (proof_id, user_id)
);

comment on table public.clip_summary_feedback is
  'Thumbs up / down and corrections on a clip''s AI summary. Written by the BFF (service role); the training-set export reads it for workspaces that opted in.';

create index if not exists clip_summary_feedback_org_idx
  on public.clip_summary_feedback (org_id, created_at desc);

alter table public.clip_summary_feedback enable row level security;

drop policy if exists clip_summary_feedback_select on public.clip_summary_feedback;
create policy clip_summary_feedback_select on public.clip_summary_feedback
  for select to authenticated
  using (private.is_org_member(org_id));

revoke insert, update, delete, truncate on public.clip_summary_feedback from anon, authenticated;
revoke all on public.clip_summary_feedback from anon;

create table if not exists public.org_ai_training_settings (
  org_id      uuid primary key references public.orgs (id) on delete cascade,
  opted_in    boolean not null default false,
  changed_by  uuid references public.profiles (id) on delete set null,
  changed_at  timestamptz not null default now()
);

comment on table public.org_ai_training_settings is
  'Whether a workspace lets its corrected AI text train Atmosphere''s own models. No row means off. Set by a Global Admin through the BFF.';

alter table public.org_ai_training_settings enable row level security;

drop policy if exists org_ai_training_settings_select on public.org_ai_training_settings;
create policy org_ai_training_settings_select on public.org_ai_training_settings
  for select to authenticated
  using (private.is_org_member(org_id));

revoke insert, update, delete, truncate on public.org_ai_training_settings from anon, authenticated;
revoke all on public.org_ai_training_settings from anon;
