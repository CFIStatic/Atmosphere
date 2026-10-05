-- Cross-org Computer site playbooks: anonymized step patterns only.
-- Never store passwords, tokens, customer/homeowner/job data, email/CRM content,
-- estimate figures, or typed field values. URLs scrubbed of IDs/query params.

create table if not exists public.computer_site_playbooks (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  task_type text not null,
  -- Anonymized JSON: screens[], selectors[], working_path[], known_errors[], recoveries[]
  playbook jsonb not null default '{}'::jsonb,
  success_count integer not null default 0,
  reject_count integer not null default 0,
  edit_count integer not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint computer_site_playbooks_site_task unique (site, task_type)
);

create index if not exists computer_site_playbooks_site_idx
  on public.computer_site_playbooks (site);

comment on table public.computer_site_playbooks is
  'Anonymized per-site Computer step playbooks shared across orgs. No PII or job data.';

alter table public.computer_site_playbooks enable row level security;

drop policy if exists computer_site_playbooks_select_authenticated on public.computer_site_playbooks;
create policy computer_site_playbooks_select_authenticated
  on public.computer_site_playbooks
  for select
  to authenticated
  using (true);

revoke insert, update, delete on public.computer_site_playbooks from authenticated, anon;
grant select on public.computer_site_playbooks to authenticated;

-- Org-scoped approval outcome signals (stay org-private under RLS).
create table if not exists public.computer_playbook_outcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  task_id uuid,
  site text not null,
  task_type text not null,
  outcome text not null check (outcome in ('approve', 'edit', 'reject')),
  playbook_id uuid references public.computer_site_playbooks(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists computer_playbook_outcomes_org_idx
  on public.computer_playbook_outcomes (org_id, created_at desc);

alter table public.computer_playbook_outcomes enable row level security;

drop policy if exists computer_playbook_outcomes_org_select on public.computer_playbook_outcomes;
create policy computer_playbook_outcomes_org_select
  on public.computer_playbook_outcomes
  for select
  to authenticated
  using (private.is_org_member(org_id));

revoke insert, update, delete on public.computer_playbook_outcomes from authenticated, anon;
grant select on public.computer_playbook_outcomes to authenticated;
