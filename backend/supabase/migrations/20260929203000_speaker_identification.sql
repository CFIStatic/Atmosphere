-- Speaker identification.
--
-- A voiceprint is a biometric template. The embedding lives in its own table
-- so teammates can see consent status without reading the template. Revoking
-- consent deletes the voiceprint and cascades the embedding. Cross-company
-- matching is off unless that person opts in on their own row. A coworker
-- request cannot become a voiceprint until the subject confirms it.

create table if not exists public.voiceprints (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users (id) on delete cascade,
  org_id               uuid not null references public.orgs (id) on delete cascade,
  consent_text         text not null check (length(btrim(consent_text)) between 20 and 4000),
  consented_at         timestamptz not null,
  cross_company_opt_in boolean not null default false,
  duration_seconds     numeric,
  embedding_model      text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.voiceprints is
  'Consented voice enrollment for one user. No audio is stored. Deleting the row revokes consent.';

comment on column public.voiceprints.cross_company_opt_in is
  'Off by default. Only the enrolled user can turn this on. Other companies may match this voiceprint only when it is true.';

create table if not exists public.voiceprint_embeddings (
  voiceprint_id uuid primary key references public.voiceprints (id) on delete cascade,
  embedding     jsonb not null,
  dimension     integer not null check (dimension > 0 and dimension <= 512)
);

comment on table public.voiceprint_embeddings is
  'Speaker embedding for a consented voiceprint. Readable by that user and the service role, not by teammates.';

create table if not exists public.voice_consent_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  org_id       uuid not null references public.orgs (id) on delete cascade,
  action       text not null check (action in ('granted', 'revoked')),
  consent_text text,
  created_at   timestamptz not null default now()
);

comment on table public.voice_consent_events is
  'Non-biometric record that consent was granted or revoked. The voiceprint itself is deleted on revoke.';

create index if not exists voice_consent_events_user_idx
  on public.voice_consent_events (org_id, user_id, created_at desc);

create table if not exists public.voice_enrollment_requests (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  requester_user_id  uuid not null references auth.users (id) on delete cascade,
  subject_user_id    uuid not null references auth.users (id) on delete cascade,
  status             text not null default 'pending' check (status in ('pending', 'confirmed', 'declined', 'cancelled')),
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  check (requester_user_id <> subject_user_id)
);

create unique index if not exists voice_enrollment_requests_one_pending_idx
  on public.voice_enrollment_requests (subject_user_id)
  where status = 'pending';

comment on table public.voice_enrollment_requests is
  'A coworker can be enrolled only after they confirm the request from their own account.';

create table if not exists public.speaker_identities (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs (id) on delete cascade,
  job_id           uuid not null references public.crm_jobs (id) on delete cascade,
  proof_id         uuid not null references public.job_proofs (id) on delete cascade,
  speaker_label    text not null check (length(btrim(speaker_label)) between 1 and 80),
  display_name     text,
  status           text not null check (status in ('pending', 'confirmed', 'rejected')),
  method           text not null check (method in ('name_pickup', 'voice_high', 'voice_medium', 'user')),
  confidence       numeric,
  voiceprint_id    uuid references public.voiceprints (id) on delete set null,
  subject_user_id  uuid,
  source_proof_id  uuid,
  source_t_sec     double precision,
  source_quote     text,
  clip_title       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (proof_id, speaker_label, method)
);

comment on table public.speaker_identities is
  'Confirmed names and pending checks for a diarized speaker. Pending rows are not identities.';

create index if not exists speaker_identities_job_idx
  on public.speaker_identities (job_id, status);

create table if not exists public.speaker_role_guesses (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  job_id        uuid not null references public.crm_jobs (id) on delete cascade,
  proof_id      uuid not null references public.job_proofs (id) on delete cascade,
  speaker_label text not null check (length(btrim(speaker_label)) between 1 and 80),
  role          text not null check (role in ('homeowner', 'subcontractor', 'crew', 'adjuster', 'other')),
  confidence    numeric not null check (confidence >= 0 and confidence <= 1),
  source_t_sec  double precision,
  source_quote  text not null check (length(btrim(source_quote)) between 1 and 500),
  clip_title    text,
  status        text not null default 'tentative' check (status in ('tentative', 'confirmed', 'corrected', 'dismissed')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (proof_id, speaker_label)
);

comment on table public.speaker_role_guesses is
  'Tentative role from what an unidentified speaker said. Never an identity and never a name.';

-- Eligible embeddings for one uploader company. Same-company prints, plus
-- other companies only when that person opted in. Rows without consent are absent.
create or replace function public.voiceprints_matchable(p_org uuid)
returns table (
  voiceprint_id uuid,
  user_id uuid,
  org_id uuid,
  full_name text,
  embedding jsonb,
  cross_company_opt_in boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.id, v.user_id, v.org_id, p.full_name, e.embedding, v.cross_company_opt_in
  from public.voiceprints v
  join public.voiceprint_embeddings e on e.voiceprint_id = v.id
  left join public.profiles p on p.id = v.user_id
  where v.consented_at is not null
    and length(btrim(v.consent_text)) > 0
    and (
      v.org_id = p_org
      or v.cross_company_opt_in is true
    );
$$;

revoke all on function public.voiceprints_matchable(uuid) from public, anon, authenticated;
grant execute on function public.voiceprints_matchable(uuid) to service_role;

alter table public.voiceprints enable row level security;
alter table public.voiceprint_embeddings enable row level security;
alter table public.voice_consent_events enable row level security;
alter table public.voice_enrollment_requests enable row level security;
alter table public.speaker_identities enable row level security;
alter table public.speaker_role_guesses enable row level security;

drop policy if exists voiceprints_select on public.voiceprints;
create policy voiceprints_select on public.voiceprints
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists voiceprints_insert on public.voiceprints;
create policy voiceprints_insert on public.voiceprints
  for insert to authenticated
  with check (user_id = auth.uid() and private.is_org_member(org_id));

drop policy if exists voiceprints_update on public.voiceprints;
create policy voiceprints_update on public.voiceprints
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and private.is_org_member(org_id));

drop policy if exists voiceprints_delete on public.voiceprints;
create policy voiceprints_delete on public.voiceprints
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists voiceprint_embeddings_select on public.voiceprint_embeddings;
create policy voiceprint_embeddings_select on public.voiceprint_embeddings
  for select to authenticated
  using (
    exists (
      select 1 from public.voiceprints v
      where v.id = voiceprint_embeddings.voiceprint_id
        and v.user_id = auth.uid()
    )
  );

drop policy if exists voiceprint_embeddings_insert on public.voiceprint_embeddings;
create policy voiceprint_embeddings_insert on public.voiceprint_embeddings
  for insert to authenticated
  with check (
    exists (
      select 1 from public.voiceprints v
      where v.id = voiceprint_embeddings.voiceprint_id
        and v.user_id = auth.uid()
    )
  );

drop policy if exists voiceprint_embeddings_update on public.voiceprint_embeddings;
create policy voiceprint_embeddings_update on public.voiceprint_embeddings
  for update to authenticated
  using (
    exists (
      select 1 from public.voiceprints v
      where v.id = voiceprint_embeddings.voiceprint_id
        and v.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.voiceprints v
      where v.id = voiceprint_embeddings.voiceprint_id
        and v.user_id = auth.uid()
    )
  );

drop policy if exists voiceprint_embeddings_delete on public.voiceprint_embeddings;
create policy voiceprint_embeddings_delete on public.voiceprint_embeddings
  for delete to authenticated
  using (
    exists (
      select 1 from public.voiceprints v
      where v.id = voiceprint_embeddings.voiceprint_id
        and v.user_id = auth.uid()
    )
  );

drop policy if exists voice_consent_events_select on public.voice_consent_events;
create policy voice_consent_events_select on public.voice_consent_events
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists voice_consent_events_insert on public.voice_consent_events;
create policy voice_consent_events_insert on public.voice_consent_events
  for insert to authenticated
  with check (user_id = auth.uid() and private.is_org_member(org_id));

drop policy if exists voice_enrollment_requests_select on public.voice_enrollment_requests;
create policy voice_enrollment_requests_select on public.voice_enrollment_requests
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists voice_enrollment_requests_insert on public.voice_enrollment_requests;
create policy voice_enrollment_requests_insert on public.voice_enrollment_requests
  for insert to authenticated
  with check (
    requester_user_id = auth.uid()
    and requester_user_id <> subject_user_id
    and private.is_org_member(org_id)
    and exists (
      select 1 from public.org_members m
      where m.org_id = voice_enrollment_requests.org_id
        and m.user_id = voice_enrollment_requests.subject_user_id
    )
  );

-- Only the subject can confirm or decline, and only while the request is pending.
-- The requester can cancel. They cannot mark the request confirmed.
drop policy if exists voice_enrollment_requests_update on public.voice_enrollment_requests;
drop policy if exists voice_enrollment_requests_subject_update on public.voice_enrollment_requests;
create policy voice_enrollment_requests_subject_update on public.voice_enrollment_requests
  for update to authenticated
  using (subject_user_id = auth.uid() and status = 'pending')
  with check (
    subject_user_id = auth.uid()
    and status in ('confirmed', 'declined')
    and private.is_org_member(org_id)
  );

drop policy if exists voice_enrollment_requests_requester_cancel on public.voice_enrollment_requests;
create policy voice_enrollment_requests_requester_cancel on public.voice_enrollment_requests
  for update to authenticated
  using (requester_user_id = auth.uid() and status = 'pending')
  with check (
    requester_user_id = auth.uid()
    and status = 'cancelled'
    and private.is_org_member(org_id)
  );

drop policy if exists speaker_identities_select on public.speaker_identities;
create policy speaker_identities_select on public.speaker_identities
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists speaker_identities_insert on public.speaker_identities;
create policy speaker_identities_insert on public.speaker_identities
  for insert to authenticated
  with check (private.is_org_member(org_id));

drop policy if exists speaker_identities_update on public.speaker_identities;
create policy speaker_identities_update on public.speaker_identities
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

drop policy if exists speaker_role_guesses_select on public.speaker_role_guesses;
create policy speaker_role_guesses_select on public.speaker_role_guesses
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists speaker_role_guesses_insert on public.speaker_role_guesses;
create policy speaker_role_guesses_insert on public.speaker_role_guesses
  for insert to authenticated
  with check (private.is_org_member(org_id));

drop policy if exists speaker_role_guesses_update on public.speaker_role_guesses;
create policy speaker_role_guesses_update on public.speaker_role_guesses
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

revoke all on public.voiceprints from anon;
revoke all on public.voiceprint_embeddings from anon;
revoke all on public.voice_consent_events from anon;
revoke all on public.voice_enrollment_requests from anon;
revoke all on public.speaker_identities from anon;
revoke all on public.speaker_role_guesses from anon;

grant select, insert, update, delete on public.voiceprints to authenticated, service_role;
grant select, insert, update, delete on public.voiceprint_embeddings to authenticated, service_role;
grant select, insert on public.voice_consent_events to authenticated;
grant select, insert, update, delete on public.voice_consent_events to service_role;
grant select, insert, update, delete on public.voice_enrollment_requests to authenticated, service_role;
grant select, insert, update, delete on public.speaker_identities to authenticated, service_role;
grant select, insert, update, delete on public.speaker_role_guesses to authenticated, service_role;
