-- Per-job Ask context / index cache. Rebuild when proofs, notes, docs, or CRM change.
-- Not applied live by the agent.

create table if not exists public.ask_job_context_cache (
  job_id           uuid primary key references public.crm_jobs (id) on delete cascade,
  org_id           uuid not null references public.orgs (id) on delete cascade,
  fingerprint      text not null,
  summary_text     text not null default '',
  index_meta       jsonb not null default '{}'::jsonb,
  rebuilt_at       timestamptz not null default now(),
  source_updated_at timestamptz
);

create index if not exists ask_job_context_cache_org_idx
  on public.ask_job_context_cache (org_id, rebuilt_at desc);

alter table public.ask_job_context_cache enable row level security;

drop policy if exists ask_job_context_cache_select on public.ask_job_context_cache;
create policy ask_job_context_cache_select on public.ask_job_context_cache
  for select to authenticated
  using (private.is_org_member(org_id));

revoke all on public.ask_job_context_cache from anon;
revoke insert, update, delete on public.ask_job_context_cache from authenticated;
grant select on public.ask_job_context_cache to authenticated;
