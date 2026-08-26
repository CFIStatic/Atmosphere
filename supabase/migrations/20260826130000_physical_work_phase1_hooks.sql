-- ---------------------------------------------------------------------------
-- Physical-work Phase 1 hooks
-- ---------------------------------------------------------------------------
-- work_episodes is TaskEpisode. This migration widens actor kinds for future
-- robotics, links optional rights_manifests (compose, do not replace
-- data_rights), and reserves decision/failure tables.

alter table public.work_episodes
  drop constraint if exists work_episodes_performer_kind_check;

alter table public.work_episodes
  add constraint work_episodes_performer_kind_check
  check (performer_kind in (
    'human', 'crew', 'robot', 'autonomous', 'human_robot', 'machine', 'mixed'
  ));

alter table public.work_episodes
  add column if not exists rights_manifest_id uuid references public.rights_manifests (id) on delete set null;

comment on column public.work_episodes.performer_kind is
  'Who acted. human|crew today; robot|autonomous|human_robot reserved. machine|mixed kept for existing rows.';

comment on column public.work_episodes.rights_manifest_id is
  'Optional link to rights_manifests. Training export composes this with data_rights + worker_consent.';

create table if not exists public.episode_decisions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  episode_id    uuid not null references public.work_episodes (id) on delete cascade,
  kind          text not null default 'method',
  summary       text check (summary is null or length(summary) <= 2000),
  source        text not null default 'derived' check (source in ('ai', 'human', 'derived')),
  created_at    timestamptz not null default now()
);

create table if not exists public.episode_failures (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.orgs (id) on delete cascade,
  episode_id                uuid not null references public.work_episodes (id) on delete cascade,
  outcome_id                uuid references public.episode_outcomes (id) on delete set null,
  mode                      text not null,
  hidden_after_concealment  boolean not null default false,
  source                    text not null default 'human' check (source in ('ai', 'human', 'derived')),
  created_at                timestamptz not null default now()
);

create index if not exists episode_decisions_episode_idx on public.episode_decisions (episode_id);
create index if not exists episode_failures_episode_idx on public.episode_failures (episode_id);

comment on table public.episode_decisions is
  'Phase 2 hook: why a method was chosen. Not written by Phase 1 APIs.';
comment on table public.episode_failures is
  'Phase 2 hook: failure modes and concealment. Longitudinal rows stay on episode_outcomes.';

do $$
declare t text;
begin
  foreach t in array array['episode_decisions', 'episode_failures'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_all on public.%I', t, t);
    execute format(
      'create policy %I_all on public.%I for all to authenticated
         using (private.is_org_member(org_id))
         with check (private.is_org_member(org_id))', t, t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
