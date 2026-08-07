-- Durable property digital twin snapshots (office viewer + App Store ingest).

create table if not exists public.property_twins (
  id              uuid primary key,
  org_id          uuid not null references public.orgs (id) on delete cascade,
  job_id          text,
  label           text not null,
  status          text not null,
  primary_source  text not null,
  payload         jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists property_twins_org_updated_idx
  on public.property_twins (org_id, updated_at desc);

alter table public.property_twins enable row level security;

do $$ begin
  create policy property_twins_select_member on public.property_twins
    for select using (
      org_id in (select org_id from public.org_members where user_id = auth.uid())
    );
exception when duplicate_object then null; end $$;

comment on table public.property_twins is
  'Measured property twins (rooms, mesh refs, work overlays, video refs).';
