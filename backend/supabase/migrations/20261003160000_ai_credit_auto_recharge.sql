-- AI credit auto-recharge.
--
-- An owner can opt in to buying one credit pack automatically with the saved
-- card when the org runs out of AI credits. It is off by default. Every
-- attempt is recorded here before Stripe is called, so the attempt id is the
-- Stripe idempotency key and a retry can never charge twice.
--
-- claim_ai_auto_recharge is the only way to start an attempt. Under a row
-- lock it checks that auto-recharge is on, that no attempt is in flight, that
-- the cooldown has passed, and that the 24-hour cap is not reached. A charge
-- that fails turns auto-recharge off (finish_ai_auto_recharge), so a declined
-- card falls back to manual purchase instead of retrying.

create table if not exists public.ai_credit_auto_recharge_settings (
  org_id           uuid primary key references public.orgs (id) on delete cascade,
  enabled          boolean not null default false,
  pack_code        text not null default 'ai_10' check (pack_code in ('ai_10', 'ai_25', 'ai_50')),
  consented_at     timestamptz,
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  disabled_reason  text,
  disabled_at      timestamptz,
  last_attempt_at  timestamptz
);

comment on table public.ai_credit_auto_recharge_settings is
  'Opt-in AI credit auto-recharge per org. Off by default. A failed charge turns it off and stores the reason shown to the owner.';

create table if not exists public.ai_credit_auto_recharges (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references public.orgs (id) on delete cascade,
  pack_code                 text not null,
  amount_cents              integer check (amount_cents is null or amount_cents > 0),
  currency                  text not null default 'usd',
  credit_nanos              bigint check (credit_nanos is null or credit_nanos >= 0),
  status                    text not null default 'pending'
                              check (status in ('pending', 'succeeded', 'failed')),
  idempotency_key           text not null,
  stripe_payment_intent_id  text,
  stripe_charge_id          text,
  failure_code              text,
  failure_message           text,
  trigger_source            text,
  created_at                timestamptz not null default now(),
  completed_at              timestamptz
);

comment on table public.ai_credit_auto_recharges is
  'One row per automatic credit-pack purchase attempt. idempotency_key is sent to Stripe so a retried attempt cannot charge twice.';

create unique index if not exists ai_credit_auto_recharges_idem_uidx
  on public.ai_credit_auto_recharges (idempotency_key);

create unique index if not exists ai_credit_auto_recharges_pi_uidx
  on public.ai_credit_auto_recharges (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- At most one attempt in flight per org.
create unique index if not exists ai_credit_auto_recharges_pending_uidx
  on public.ai_credit_auto_recharges (org_id)
  where status = 'pending';

create index if not exists ai_credit_auto_recharges_org_idx
  on public.ai_credit_auto_recharges (org_id, created_at desc);

create or replace function public.claim_ai_auto_recharge(
  p_org uuid,
  p_cooldown_seconds integer,
  p_max_per_day integer,
  p_stale_seconds integer default 900,
  p_trigger text default null
)
returns table (
  claimed boolean,
  reason text,
  recharge_id uuid,
  idempotency_key text,
  pack_code text
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_settings public.ai_credit_auto_recharge_settings%rowtype;
  v_recent integer;
  v_id uuid;
  v_key text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into v_settings
    from public.ai_credit_auto_recharge_settings s
   where s.org_id = p_org
   for update;

  if not found or not v_settings.enabled then
    return query select false, 'disabled'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- An attempt left pending by a crash is closed out as failed after
  -- p_stale_seconds; the webhook still grants credits if Stripe did charge.
  update public.ai_credit_auto_recharges r
     set status = 'failed',
         failure_code = 'stale_attempt',
         failure_message = 'The attempt did not finish.',
         completed_at = now()
   where r.org_id = p_org
     and r.status = 'pending'
     and r.created_at < now() - make_interval(secs => greatest(p_stale_seconds, 60));

  if exists (
    select 1 from public.ai_credit_auto_recharges r
     where r.org_id = p_org and r.status = 'pending'
  ) then
    return query select false, 'in_flight'::text, null::uuid, null::text, null::text;
    return;
  end if;

  if v_settings.last_attempt_at is not null
     and v_settings.last_attempt_at > now() - make_interval(secs => greatest(p_cooldown_seconds, 0)) then
    return query select false, 'cooldown'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select count(*) into v_recent
    from public.ai_credit_auto_recharges r
   where r.org_id = p_org
     and r.created_at > now() - interval '24 hours';

  if v_recent >= greatest(p_max_per_day, 0) then
    return query select false, 'daily_cap'::text, null::uuid, null::text, null::text;
    return;
  end if;

  v_id := gen_random_uuid();
  v_key := 'ai-auto-recharge:' || p_org::text || ':' || v_id::text;

  insert into public.ai_credit_auto_recharges (id, org_id, pack_code, idempotency_key, trigger_source)
  values (v_id, p_org, v_settings.pack_code, v_key, p_trigger);

  update public.ai_credit_auto_recharge_settings s
     set last_attempt_at = now()
   where s.org_id = p_org;

  return query select true, 'claimed'::text, v_id, v_key, v_settings.pack_code;
end $$;

comment on function public.claim_ai_auto_recharge(uuid, integer, integer, integer, text) is
  'Starts one auto-recharge attempt if auto-recharge is on, nothing is in flight, the cooldown has passed, and the 24-hour cap is not reached.';

create or replace function public.finish_ai_auto_recharge(
  p_recharge uuid,
  p_status text,
  p_payment_intent_id text default null,
  p_charge_id text default null,
  p_amount_cents integer default null,
  p_currency text default null,
  p_credit_nanos bigint default null,
  p_failure_code text default null,
  p_failure_message text default null
)
returns public.ai_credit_auto_recharges
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_row public.ai_credit_auto_recharges%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into v_row from public.ai_credit_auto_recharges where id = p_recharge for update;
  if not found then
    raise exception 'unknown_recharge' using errcode = 'P0002';
  end if;

  -- A success is final: a late failure report cannot undo a paid charge.
  if v_row.status = 'succeeded' then
    return v_row;
  end if;

  update public.ai_credit_auto_recharges set
    status = p_status,
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
    stripe_charge_id = coalesce(p_charge_id, stripe_charge_id),
    amount_cents = coalesce(p_amount_cents, amount_cents),
    currency = coalesce(p_currency, currency),
    credit_nanos = coalesce(p_credit_nanos, credit_nanos),
    failure_code = case when p_status = 'failed' then p_failure_code else null end,
    failure_message = case when p_status = 'failed' then p_failure_message else null end,
    completed_at = now()
  where id = p_recharge
  returning * into v_row;

  if p_status = 'failed' then
    update public.ai_credit_auto_recharge_settings set
      enabled = false,
      disabled_reason = coalesce(p_failure_message, 'The automatic charge failed.'),
      disabled_at = now(),
      updated_at = now()
    where org_id = v_row.org_id;
  end if;

  return v_row;
end $$;

comment on function public.finish_ai_auto_recharge(uuid, text, text, text, integer, text, bigint, text, text) is
  'Closes an auto-recharge attempt. A failure turns auto-recharge off and stores the reason for the owner.';

alter table public.ai_credit_auto_recharge_settings enable row level security;
alter table public.ai_credit_auto_recharges enable row level security;

drop policy if exists ai_credit_auto_recharge_settings_select on public.ai_credit_auto_recharge_settings;
create policy ai_credit_auto_recharge_settings_select on public.ai_credit_auto_recharge_settings
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists ai_credit_auto_recharges_select on public.ai_credit_auto_recharges;
create policy ai_credit_auto_recharges_select on public.ai_credit_auto_recharges
  for select to authenticated
  using (private.is_org_member(org_id));

revoke all on public.ai_credit_auto_recharge_settings from public, anon;
revoke all on public.ai_credit_auto_recharges from public, anon;
grant select on public.ai_credit_auto_recharge_settings to authenticated;
grant select on public.ai_credit_auto_recharges to authenticated;
grant all on public.ai_credit_auto_recharge_settings to service_role;
grant all on public.ai_credit_auto_recharges to service_role;

revoke execute on function public.claim_ai_auto_recharge(uuid, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.finish_ai_auto_recharge(uuid, text, text, text, integer, text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.claim_ai_auto_recharge(uuid, integer, integer, integer, text) to service_role;
grant execute on function public.finish_ai_auto_recharge(uuid, text, text, text, integer, text, bigint, text, text) to service_role;
