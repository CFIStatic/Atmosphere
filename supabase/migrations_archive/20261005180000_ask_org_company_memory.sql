-- Org-wide Ask company memory: durable facts learned across jobs
-- (adjusters, carriers, pricing habits, office preferences).
-- Scoped to the organization. Restricted rows (tied to source jobs) are only
-- readable when the caller can access every source job — enforced in RLS and
-- again in the Ask loader when using the service role.

create table if not exists public.ask_org_memory_facts (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs (id) on delete cascade,
  kind               text not null check (kind in (
    'adjuster', 'carrier', 'pricing', 'preference', 'contact', 'other'
  )),
  label              text not null check (length(label) between 1 and 200),
  detail             text not null check (length(detail) between 1 and 2000),
  -- When true, only people who can access every source_job_id may read this row.
  restricted         boolean not null default false,
  source_job_ids     uuid[] not null default '{}',
  source_question_id uuid,
  confidence         real not null default 0.6 check (confidence >= 0 and confidence <= 1),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ask_org_memory_facts_label_kind_org unique (org_id, kind, label)
);

create index if not exists ask_org_memory_facts_org_kind_idx
  on public.ask_org_memory_facts (org_id, kind, updated_at desc);

create index if not exists ask_org_memory_facts_org_updated_idx
  on public.ask_org_memory_facts (org_id, updated_at desc);

comment on table public.ask_org_memory_facts is
  'Company-wide Ask memory: org-scoped facts across jobs. Restricted rows require access to every source job.';

-- Helper: can this auth user open a job file in the org?
create or replace function private.user_can_access_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.crm_jobs j
    where j.id = p_job_id
      and private.is_org_member(j.org_id)
      and (
        j.created_by = auth.uid()
        or exists (
          select 1 from public.job_assignments a
          where a.job_id = j.id and a.user_id = auth.uid() and a.released_at is null
        )
        or exists (
          select 1 from public.job_progress_grants g
          where g.job_id = j.id and g.user_id = auth.uid()
        )
        or exists (
          select 1 from public.org_members m
          where m.org_id = j.org_id
            and m.user_id = auth.uid()
            and m.role::text in ('global_admin', 'owner', 'admin', 'office_manager')
        )
      )
  );
$$;

revoke all on function private.user_can_access_job(uuid) from public, anon, authenticated;
grant execute on function private.user_can_access_job(uuid) to authenticated;

alter table public.ask_org_memory_facts enable row level security;

drop policy if exists ask_org_memory_facts_select on public.ask_org_memory_facts;
create policy ask_org_memory_facts_select on public.ask_org_memory_facts
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and (
      restricted is not true
      or cardinality(source_job_ids) = 0
      or (
        select bool_and(private.user_can_access_job(jid))
        from unnest(source_job_ids) as jid
      )
    )
  );

drop policy if exists ask_org_memory_facts_insert on public.ask_org_memory_facts;
create policy ask_org_memory_facts_insert on public.ask_org_memory_facts
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and created_by = auth.uid()
  );

drop policy if exists ask_org_memory_facts_update on public.ask_org_memory_facts;
create policy ask_org_memory_facts_update on public.ask_org_memory_facts
  for update to authenticated
  using (private.is_org_member(org_id))
  with check (private.is_org_member(org_id));

revoke all on public.ask_org_memory_facts from anon;
revoke delete on public.ask_org_memory_facts from authenticated;
grant select, insert, update on public.ask_org_memory_facts to authenticated;
