-- Atmosphere Analytics: staff email campaigns (drafts, sends, suppressions).
--
-- Contacts are NOT stored here. The BFF reads them from Stripe (and, later,
-- other sources) on demand. Only what a campaign needs to be honest and
-- lawful is kept:
--
--   analytics_campaigns           drafts and their audience filter
--   analytics_campaign_sends      one row per recipient actually attempted,
--                                 with the unsubscribe token for that email
--   analytics_email_suppressions  addresses that must never be mailed again
--
-- All three are staff-only: RLS on, no policies, no grants to anon or
-- authenticated. Every function below re-checks the caller's analytics_staff
-- row at internal scope (private.require_analytics('internal'), using the
-- 20261002193000_internal_analytics_actor pattern) and is EXECUTE for
-- service_role only.
--
-- record_unsubscribe(p_token) is replaced. Its previous body read
-- public.crm_sends, which 20260828220000_drop_old_product_tables dropped, so
-- every unsubscribe click since then was a silent no-op. It now records
-- campaign unsubscribes in analytics_email_suppressions. It still answers
-- true for any token, so the route cannot be used as an oracle.
--
-- Safe to re-run.

create table if not exists public.analytics_campaigns (
  id               uuid        primary key default gen_random_uuid(),
  name             text        not null check (char_length(name) between 1 and 200),
  subject          text        not null default '' check (char_length(subject) <= 200),
  body_markdown    text        not null default '' check (char_length(body_markdown) <= 50000),
  audience         jsonb       not null default '{}'::jsonb,
  status           text        not null default 'draft'
                               check (status in ('draft', 'sending', 'sent', 'failed')),
  created_by       uuid,
  updated_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  sent_at          timestamptz,
  recipient_count  integer,
  sent_count       integer,
  failed_count     integer,
  suppressed_count integer
);

create table if not exists public.analytics_campaign_sends (
  id                  uuid        primary key default gen_random_uuid(),
  campaign_id         uuid        not null references public.analytics_campaigns(id) on delete cascade,
  email               text        not null check (email = lower(email) and char_length(email) <= 320),
  unsubscribe_token   text        not null unique
                                  default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  status              text        not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_message_id text,
  error               text        check (error is null or char_length(error) <= 500),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  unique (campaign_id, email)
);

create table if not exists public.analytics_email_suppressions (
  email       text        primary key check (email = lower(email) and char_length(email) <= 320),
  reason      text        not null check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual')),
  campaign_id uuid        references public.analytics_campaigns(id) on delete set null,
  created_by  uuid,
  created_at  timestamptz not null default now()
);

create index if not exists analytics_campaign_sends_campaign_idx
  on public.analytics_campaign_sends (campaign_id);

alter table public.analytics_campaigns          enable row level security;
alter table public.analytics_campaign_sends     enable row level security;
alter table public.analytics_email_suppressions enable row level security;

revoke all on table public.analytics_campaigns          from public, anon, authenticated;
revoke all on table public.analytics_campaign_sends     from public, anon, authenticated;
revoke all on table public.analytics_email_suppressions from public, anon, authenticated;
grant select, insert, update, delete on table public.analytics_campaigns          to service_role;
grant select, insert, update         on table public.analytics_campaign_sends     to service_role;
grant select, insert, update, delete on table public.analytics_email_suppressions to service_role;

create or replace function private.analytics_campaign_json(c public.analytics_campaigns)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'subject', c.subject, 'body_markdown', c.body_markdown,
    'audience', c.audience, 'status', c.status,
    'created_at', c.created_at, 'updated_at', c.updated_at, 'sent_at', c.sent_at,
    'recipient_count', c.recipient_count, 'sent_count', c.sent_count,
    'failed_count', c.failed_count, 'suppressed_count', c.suppressed_count);
$$;

revoke all on function private.analytics_campaign_json(public.analytics_campaigns) from public, anon, authenticated;

create or replace function public.analytics_campaigns_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_analytics('internal');
  return jsonb_build_object(
    'campaigns', coalesce((
      select jsonb_agg(private.analytics_campaign_json(c) order by c.updated_at desc)
      from public.analytics_campaigns c), '[]'::jsonb),
    'suppressed', (select count(*) from public.analytics_email_suppressions));
end;
$$;

create or replace function public.analytics_campaign_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  c public.analytics_campaigns;
begin
  perform private.require_analytics('internal');
  select * into c from public.analytics_campaigns where id = p_id;
  if not found then
    return null;
  end if;
  return private.analytics_campaign_json(c);
end;
$$;

-- Insert (p_id null) or update a draft. Sent campaigns are read-only.
create or replace function public.analytics_campaign_save(
  p_id       uuid,
  p_name     text,
  p_subject  text,
  p_body     text,
  p_audience jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  c public.analytics_campaigns;
begin
  perform private.require_analytics('internal');
  v_actor := private.analytics_actor();

  if p_id is null then
    insert into public.analytics_campaigns (name, subject, body_markdown, audience, created_by, updated_by)
    values (coalesce(nullif(btrim(p_name), ''), 'Untitled campaign'), coalesce(p_subject, ''),
            coalesce(p_body, ''), coalesce(p_audience, '{}'::jsonb), v_actor, v_actor)
    returning * into c;
  else
    update public.analytics_campaigns
       set name = coalesce(nullif(btrim(p_name), ''), name),
           subject = coalesce(p_subject, subject),
           body_markdown = coalesce(p_body, body_markdown),
           audience = coalesce(p_audience, audience),
           updated_by = v_actor,
           updated_at = now()
     where id = p_id and status = 'draft'
    returning * into c;
    if not found then
      raise exception 'campaign_not_editable' using errcode = 'P0002';
    end if;
  end if;
  return private.analytics_campaign_json(c);
end;
$$;

create or replace function public.analytics_campaign_delete(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_analytics('internal');
  delete from public.analytics_campaigns where id = p_id and status = 'draft';
  return found;
end;
$$;

-- Which of these addresses are suppressed. Used for audience counts.
create or replace function public.analytics_email_suppressed(p_emails text[])
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_analytics('internal');
  return coalesce((
    select array_agg(s.email order by s.email)
    from public.analytics_email_suppressions s
    where s.email = any (select lower(btrim(e)) from unnest(coalesce(p_emails, '{}')) e)), '{}');
end;
$$;

-- Lock a draft, drop suppressed addresses, and mint one send row (with its
-- unsubscribe token) per remaining address. Only a draft can start sending,
-- so a double click cannot mail anyone twice.
create or replace function public.analytics_campaign_begin_send(p_id uuid, p_emails text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c public.analytics_campaigns;
  v_total integer;
  v_suppressed integer;
  v_recipients jsonb;
begin
  perform private.require_analytics('internal');

  select * into c from public.analytics_campaigns where id = p_id for update;
  if not found or c.status <> 'draft' then
    raise exception 'campaign_not_sendable' using errcode = 'P0002';
  end if;

  with wanted as (
    select distinct lower(btrim(e)) as email
    from unnest(coalesce(p_emails, '{}')) e
    where e is not null and btrim(e) like '%_@_%'
  ),
  kept as (
    select w.email from wanted w
    where not exists (select 1 from public.analytics_email_suppressions s where s.email = w.email)
  ),
  ins as (
    insert into public.analytics_campaign_sends (campaign_id, email)
    select p_id, k.email from kept k
    on conflict (campaign_id, email) do nothing
    returning email, unsubscribe_token
  )
  select (select count(*) from wanted),
         (select count(*) from wanted) - (select count(*) from kept),
         coalesce(jsonb_agg(jsonb_build_object('email', email, 'token', unsubscribe_token) order by email), '[]'::jsonb)
    into v_total, v_suppressed, v_recipients
  from ins;

  update public.analytics_campaigns
     set status = 'sending',
         recipient_count = jsonb_array_length(v_recipients),
         suppressed_count = v_suppressed,
         updated_by = private.analytics_actor(),
         updated_at = now()
   where id = p_id;

  return jsonb_build_object('recipients', v_recipients, 'suppressed', v_suppressed, 'requested', v_total);
end;
$$;

-- Record provider results: [{ "email", "ok", "provider_id", "error" }].
create or replace function public.analytics_campaign_finish_send(p_id uuid, p_results jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c public.analytics_campaigns;
  v_sent integer;
  v_failed integer;
begin
  perform private.require_analytics('internal');

  update public.analytics_campaign_sends s
     set status = case when (r ->> 'ok')::boolean then 'sent' else 'failed' end,
         provider_message_id = left(r ->> 'provider_id', 200),
         error = left(r ->> 'error', 500),
         sent_at = case when (r ->> 'ok')::boolean then now() end
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
   where s.campaign_id = p_id and s.email = lower(r ->> 'email');

  select count(*) filter (where status = 'sent'), count(*) filter (where status = 'failed')
    into v_sent, v_failed
  from public.analytics_campaign_sends where campaign_id = p_id;

  update public.analytics_campaigns
     set status = case when v_sent = 0 and v_failed > 0 then 'failed' else 'sent' end,
         sent_count = v_sent,
         failed_count = v_failed,
         sent_at = now(),
         updated_at = now()
   where id = p_id and status = 'sending'
  returning * into c;

  if not found then
    raise exception 'campaign_not_sending' using errcode = 'P0002';
  end if;
  return private.analytics_campaign_json(c);
end;
$$;

-- Public unsubscribe link (/api/unsubscribe?t=…). Service role only; the
-- route is the sole caller. Always true: never reveal whether a token exists.
create or replace function public.record_unsubscribe(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_send public.analytics_campaign_sends%rowtype;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return true;
  end if;

  select * into v_send from public.analytics_campaign_sends where unsubscribe_token = p_token;
  if not found then
    return true;
  end if;

  insert into public.analytics_email_suppressions (email, reason, campaign_id)
  values (v_send.email, 'unsubscribe', v_send.campaign_id)
  on conflict (email) do nothing;

  return true;
end;
$$;

do $grants$
declare
  sig regprocedure;
begin
  foreach sig in array array[
    'public.analytics_campaigns_list()'::regprocedure,
    'public.analytics_campaign_get(uuid)'::regprocedure,
    'public.analytics_campaign_save(uuid, text, text, text, jsonb)'::regprocedure,
    'public.analytics_campaign_delete(uuid)'::regprocedure,
    'public.analytics_email_suppressed(text[])'::regprocedure,
    'public.analytics_campaign_begin_send(uuid, text[])'::regprocedure,
    'public.analytics_campaign_finish_send(uuid, jsonb)'::regprocedure,
    'public.record_unsubscribe(text)'::regprocedure
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', sig);
    execute format('grant execute on function %s to service_role', sig);
  end loop;
end
$grants$;
