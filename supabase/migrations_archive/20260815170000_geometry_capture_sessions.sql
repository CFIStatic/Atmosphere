-- Durable geometry / RoomPlan capture sessions on the existing Supabase project.

create table if not exists public.geometry_capture_sessions (
  id               uuid primary key,
  org_id           uuid not null references public.orgs (id) on delete cascade,
  job_id           text,
  twin_id          uuid not null references public.property_twins (id) on delete cascade,
  platform         text not null,
  measure_api      text,
  lidar_available  boolean,
  video_ref        text,
  status           text not null,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists geometry_capture_sessions_org_idx
  on public.geometry_capture_sessions (org_id, created_at desc);

alter table public.geometry_capture_sessions enable row level security;

do $$ begin
  create policy geometry_capture_sessions_select_member on public.geometry_capture_sessions
    for select using (
      org_id in (select org_id from public.org_members where user_id = auth.uid())
    );
exception when duplicate_object then null; end $$;
