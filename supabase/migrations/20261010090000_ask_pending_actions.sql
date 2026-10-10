-- Chat approvals: an action Chat proposed (send a text, revoke access) waits
-- here until the person presses Approve or Deny on its card. The server does
-- the action only from an approval of this row; the model cannot.

create table if not exists public.ask_pending_actions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  job_id      uuid not null references public.crm_jobs (id) on delete cascade,
  -- Who asked; only they (or another office member) may decide.
  requested_by uuid references public.profiles (id) on delete set null,
  kind        text not null check (kind in ('send_job_sms', 'revoke_access')),
  -- What will happen, exactly as shown on the card (phone and body, or person).
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'denied', 'expired', 'failed')),
  -- Plain outcome for the receipt ("Text sent to …", "Twilio is not connected").
  result      text,
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  created_at  timestamptz not null default now()
);

comment on table public.ask_pending_actions is
  'Actions Chat proposed and is waiting for a person to approve or deny on the card. Only an approval of the row runs the action.';

create index if not exists ask_pending_actions_job_idx
  on public.ask_pending_actions (org_id, job_id, created_at desc);

alter table public.ask_pending_actions enable row level security;

drop policy if exists ask_pending_actions_org_read on public.ask_pending_actions;
create policy ask_pending_actions_org_read on public.ask_pending_actions
  for select to authenticated
  using (private.is_org_member(org_id));

-- Writes go through the BFF's service role, which runs the action.
revoke insert, update, delete on public.ask_pending_actions from authenticated, anon;
grant select on public.ask_pending_actions to authenticated;
