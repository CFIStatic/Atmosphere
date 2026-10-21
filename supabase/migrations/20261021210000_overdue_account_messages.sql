-- Behind on payments (Atmosphere Analytics): a record of every email and text
-- staff send to a workspace that owes money.
--
-- One row per recipient per send, with who sent it and whether the provider
-- accepted it. Written and read only by the server (service role) after the
-- analytics route checks internal staff scope. Customers never see it.

create table if not exists public.overdue_account_messages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  channel       text not null check (channel in ('email', 'sms')),
  recipient     text not null check (length(recipient) between 3 and 320),
  subject       text check (subject is null or length(subject) <= 200),
  body          text not null check (length(body) between 1 and 5000),
  status        text not null check (status in ('sent', 'failed', 'logged')),
  error         text check (error is null or length(error) <= 1000),
  provider_id   text,
  amount_due_cents bigint,
  sent_by       uuid references auth.users (id) on delete set null,
  sent_by_email text,
  created_at    timestamptz not null default now()
);

create index if not exists overdue_account_messages_org_created
  on public.overdue_account_messages (org_id, created_at desc);

alter table public.overdue_account_messages enable row level security;
revoke all on public.overdue_account_messages from anon, authenticated;
grant select, insert on public.overdue_account_messages to service_role;
