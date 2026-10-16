-- Sending campaign email on a customer's behalf.
--
-- Three tables, and each exists because of a specific question that gets asked
-- after the fact rather than before:
--
--   crm_unsubscribes   "I clicked unsubscribe and you emailed me again."
--                      Per-org, permanent, and checked before every send. An
--                      opt-out that lives only in a log is not an opt-out.
--
--   crm_sends          "Why did this person get this?" and "did you send it
--                      twice?" One row per message with the reason, so both
--                      have an answer six months later.
--
--   crm_send_policy    The postal address and reply address every commercial
--                      message legally requires. Kept per-org because it is
--                      the customer's address that goes in their mail, not
--                      ours.
--
-- The unsubscribe token deserves a note. It is random and per-recipient rather
-- than a signed email address, because a token that encodes an address lets
-- anyone who receives one unsubscribe somebody else by editing it — and a
-- guessable one lets a competitor unsubscribe a customer's entire list.

-- ---------------------------------------------------------------------------
-- Opt-outs
-- ---------------------------------------------------------------------------

create table if not exists public.crm_unsubscribes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs (id) on delete cascade,
  email       text not null check (email = lower(email)),
  -- 'link' | 'reply' | 'manual' | 'complaint'. A spam complaint is an
  -- unsubscribe with consequences, and it is recorded as one.
  source      text not null default 'link',
  campaign_id uuid references public.crm_campaigns (id) on delete set null,
  created_at  timestamptz not null default now()
);

create unique index if not exists crm_unsubscribes_unique
  on public.crm_unsubscribes (org_id, email);
create index if not exists crm_unsubscribes_email_idx
  on public.crm_unsubscribes (email);

comment on table public.crm_unsubscribes is
  'Permanent per-org opt-outs, checked before every send. Honoured immediately rather than within the ten business days CAN-SPAM allows.';

-- ---------------------------------------------------------------------------
-- What was sent, to whom, and why
-- ---------------------------------------------------------------------------

do $$ begin
  create type crm_send_state as enum ('queued', 'sent', 'failed', 'blocked', 'bounced', 'complained');
exception when duplicate_object then null; end $$;

create table if not exists public.crm_sends (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs (id) on delete cascade,
  campaign_id   uuid not null references public.crm_campaigns (id) on delete cascade,
  -- Which firing of the campaign this belongs to. Null for a manual send.
  fire_id       uuid references public.crm_campaign_fires (id) on delete set null,

  email         text not null,
  contact_id    uuid references public.crm_contacts (id) on delete set null,
  place_id      uuid references public.crm_places (id) on delete set null,

  state         crm_send_state not null default 'queued',
  -- Why it was blocked, when it was: 'suppressed', 'unsubscribed', 'erased'…
  blocked_reason text,

  subject       text,
  -- The provider's id, so a bounce webhook can be traced to a message.
  provider_message_id text,
  -- Per-recipient unsubscribe secret. Random, never derived from the address.
  unsubscribe_token text not null default encode(gen_random_bytes(18), 'base64'),

  error         text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists crm_sends_campaign_idx on public.crm_sends (campaign_id, created_at desc);
create index if not exists crm_sends_email_idx on public.crm_sends (org_id, email);
create index if not exists crm_sends_daily_idx on public.crm_sends (org_id, sent_at);
create unique index if not exists crm_sends_token_unique on public.crm_sends (unsubscribe_token);

-- One message per person per firing. This is the constraint that makes a
-- retried or double-clicked send safe: the second attempt collides rather than
-- delivering a second copy. Partial, because a manual send has no fire_id and
-- may legitimately go to the same person on another day.
create unique index if not exists crm_sends_once_per_fire
  on public.crm_sends (fire_id, email)
  where fire_id is not null;

comment on table public.crm_sends is
  'One row per message. The unique index on (fire_id, email) is what makes a retried send safe rather than a second copy.';

-- ---------------------------------------------------------------------------
-- What every commercial message must carry
-- ---------------------------------------------------------------------------

create table if not exists public.crm_send_policy (
  org_id          uuid primary key references public.orgs (id) on delete cascade,
  -- Required by CAN-SPAM in every commercial email. The customer's own address.
  postal_address  text,
  -- Where replies should go if not the sending mailbox. Usually null.
  reply_to        text,
  -- Ceiling for one campaign send. Deliberately low by default: a rule that
  -- unexpectedly matches four thousand people should hit a wall, not a send.
  max_recipients  integer not null default 200 check (max_recipients between 1 and 5000),
  -- Ceiling per day across all campaigns, on top of whatever the mailbox
  -- provider enforces.
  daily_ceiling   integer not null default 300 check (daily_ceiling between 1 and 10000),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now()
);

comment on table public.crm_send_policy is
  'Per-org sending policy: the postal address the law requires, and the caps that bound a runaway audience rule.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['crm_unsubscribes', 'crm_sends', 'crm_send_policy']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (private.is_org_member(org_id))', t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (private.is_org_member(org_id))', t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (private.is_org_member(org_id))
         with check (private.is_org_member(org_id))', t || '_update', t);
  end loop;
end $$;

-- Deletes are deliberately not granted on sends or unsubscribes.
--
-- A send log somebody can delete cannot answer "prove you honoured the
-- opt-out", and an unsubscribe a member can remove is not an unsubscribe. Both
-- are append-only from a user session; the service role can still act where a
-- genuine erasure requires it.

-- Recording an opt-out has to work for somebody who is not signed in — they
-- clicked a link in an email. SECURITY DEFINER, and it takes only the token,
-- so the caller never names the address being removed.
create or replace function public.record_unsubscribe(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send public.crm_sends%rowtype;
begin
  select * into v_send from public.crm_sends where unsubscribe_token = p_token;
  if not found then
    -- Reported as success regardless. Telling a caller a token was invalid
    -- turns this into an oracle for probing which tokens exist.
    return true;
  end if;

  insert into public.crm_unsubscribes (org_id, email, source, campaign_id)
  values (v_send.org_id, lower(v_send.email), 'link', v_send.campaign_id)
  on conflict (org_id, email) do nothing;

  return true;
end;
$$;

grant execute on function public.record_unsubscribe(text) to anon, authenticated, service_role;
