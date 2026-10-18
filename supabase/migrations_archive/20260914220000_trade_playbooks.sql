-- ---------------------------------------------------------------------------
-- Trade playbook library — reusable checklist / skill cards from job analysis
-- ---------------------------------------------------------------------------
-- Org-scoped playbooks turn completed day-film analysis into ordered steps
-- (e.g. roofing tear-off → dry-in). Sources snapshot analysis for a future
-- training corpus. Writes go through the BFF (service role).

create table if not exists public.trade_playbooks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  title           text not null check (length(title) between 1 and 200),
  trade           text check (trade is null or length(trade) between 1 and 80),
  summary         text check (summary is null or length(summary) <= 4000),
  status          text not null default 'draft'
                    check (status in ('draft', 'published', 'archived')),
  source_kind     text not null default 'manual'
                    check (source_kind in ('job_analysis', 'manual', 'seeded')),
  source_job_id   uuid references public.crm_jobs (id) on delete set null,
  skill_tags      text[] not null default '{}',
  step_count      integer not null default 0 check (step_count >= 0),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.trade_playbooks is
  'Org-scoped reusable trade checklists / skill cards. Generated from '
  'completed job analysis or created manually. Foundation for training corpus.';

create index if not exists trade_playbooks_org_updated_idx
  on public.trade_playbooks (org_id, updated_at desc);

create index if not exists trade_playbooks_org_trade_status_idx
  on public.trade_playbooks (org_id, trade, status);

create index if not exists trade_playbooks_source_job_idx
  on public.trade_playbooks (source_job_id)
  where source_job_id is not null;

create table if not exists public.trade_playbook_steps (
  id              uuid primary key default gen_random_uuid(),
  playbook_id     uuid not null references public.trade_playbooks (id) on delete cascade,
  position        integer not null check (position >= 0),
  title           text not null check (length(title) between 1 and 200),
  instruction     text check (instruction is null or length(instruction) <= 4000),
  skill_key       text check (skill_key is null or length(skill_key) between 1 and 64),
  evidence_hint   text check (evidence_hint is null or length(evidence_hint) <= 1000),
  metadata        jsonb not null default '{}'::jsonb,
  unique (playbook_id, position)
);

comment on table public.trade_playbook_steps is
  'Ordered checklist / skill-card steps belonging to a trade playbook.';

create index if not exists trade_playbook_steps_playbook_idx
  on public.trade_playbook_steps (playbook_id, position);

create table if not exists public.trade_playbook_sources (
  id                  uuid primary key default gen_random_uuid(),
  playbook_id         uuid not null references public.trade_playbooks (id) on delete cascade,
  job_id              uuid references public.crm_jobs (id) on delete set null,
  proof_id            uuid references public.job_proofs (id) on delete set null,
  episode_id          uuid,
  analysis_snapshot   jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

comment on table public.trade_playbook_sources is
  'Provenance linking a playbook to the job analysis snapshot used to generate it.';

create index if not exists trade_playbook_sources_playbook_idx
  on public.trade_playbook_sources (playbook_id, created_at desc);

create index if not exists trade_playbook_sources_job_idx
  on public.trade_playbook_sources (job_id)
  where job_id is not null;

alter table public.trade_playbooks enable row level security;
alter table public.trade_playbook_steps enable row level security;
alter table public.trade_playbook_sources enable row level security;

drop policy if exists trade_playbooks_select_member on public.trade_playbooks;
create policy trade_playbooks_select_member on public.trade_playbooks
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists trade_playbook_steps_select_member on public.trade_playbook_steps;
create policy trade_playbook_steps_select_member on public.trade_playbook_steps
  for select to authenticated
  using (
    exists (
      select 1 from public.trade_playbooks p
      where p.id = playbook_id and private.is_org_member(p.org_id)
    )
  );

drop policy if exists trade_playbook_sources_select_member on public.trade_playbook_sources;
create policy trade_playbook_sources_select_member on public.trade_playbook_sources
  for select to authenticated
  using (
    exists (
      select 1 from public.trade_playbooks p
      where p.id = playbook_id and private.is_org_member(p.org_id)
    )
  );

grant select on public.trade_playbooks to authenticated;
grant select on public.trade_playbook_steps to authenticated;
grant select on public.trade_playbook_sources to authenticated;
grant all on public.trade_playbooks to service_role;
grant all on public.trade_playbook_steps to service_role;
grant all on public.trade_playbook_sources to service_role;
