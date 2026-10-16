-- Durable Ask routing decisions (cheap vs Opus). Not applied live by the agent.

create table if not exists public.ask_route_decisions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.orgs (id) on delete set null,
  job_id      uuid references public.crm_jobs (id) on delete set null,
  question    text not null check (length(question) between 1 and 2000),
  route       text not null check (route in ('fast', 'deep')),
  reason      text not null,
  unsure      boolean not null default false,
  model_hint  text,
  created_at  timestamptz not null default now()
);

create index if not exists ask_route_decisions_job_idx
  on public.ask_route_decisions (job_id, created_at desc);

create index if not exists ask_route_decisions_org_idx
  on public.ask_route_decisions (org_id, created_at desc);

alter table public.ask_route_decisions enable row level security;

drop policy if exists ask_route_decisions_select on public.ask_route_decisions;
create policy ask_route_decisions_select on public.ask_route_decisions
  for select to authenticated
  using (org_id is not null and private.is_org_member(org_id));

revoke all on public.ask_route_decisions from anon;
revoke insert, update, delete on public.ask_route_decisions from authenticated;
grant select on public.ask_route_decisions to authenticated;
