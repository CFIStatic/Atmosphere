-- Portal "cancel at period end" must survive the next subscription.updated.
-- stripe_sync_subscription previously forced cancel_at_period_end = false.

drop function if exists public.stripe_sync_subscription(
  uuid, text, public.billing_interval, integer, text, public.subscription_status, timestamptz, timestamptz
);

create or replace function public.stripe_sync_subscription(
  p_org uuid, p_plan text, p_interval public.billing_interval,
  p_seats integer, p_subscription_id text, p_status public.subscription_status,
  p_period_start timestamptz, p_period_end timestamptz,
  p_cancel_at_period_end boolean default false)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_temp' as $$
declare
  b public.org_billing%rowtype; p public.billing_plans%rowtype;
  v_grant bigint; v_lot uuid; v_changed boolean;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;

  select * into p from public.billing_plans where code = p_plan;
  if not found then raise exception 'unknown_plan' using detail = p_plan, errcode = 'P0002'; end if;

  perform private.advance_billing_period(p_org);
  select * into b from public.org_billing where org_id = p_org for update;

  v_changed := b.plan_code is distinct from p_plan
            or b.seats is distinct from p_seats
            or b.period_end is distinct from p_period_end;

  if v_changed then
    insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
    select org_id, 'expiration', 'plan', -remaining_nanos, 'Subscription changed', id
    from public.credit_lots where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

    update public.credit_lots set remaining_nanos = 0
     where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;
  end if;

  update public.org_billing set
    plan_code = p_plan, billing_interval = p_interval, seats = greatest(p_seats, 1),
    status = p_status, stripe_subscription_id = p_subscription_id,
    period_start = coalesce(p_period_start, period_start),
    period_end = coalesce(p_period_end, period_end),
    cancel_at_period_end = p_cancel_at_period_end
  where org_id = p_org returning * into b;

  if v_changed then
    v_grant := p.included_credits_nanos * (case when p.per_seat then b.seats else 1 end);
    if v_grant > 0 then
      insert into public.credit_lots (org_id, bucket, granted_nanos, remaining_nanos, expires_at, description)
      values (p_org, 'plan', v_grant, v_grant, b.period_end, p.name || ' plan credits')
      returning id into v_lot;
      insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
      values (p_org, 'plan_grant', 'plan', v_grant, p.name || ' plan credits', v_lot);
    end if;
  end if;

  return jsonb_build_object('plan', p_plan, 'changed', v_changed,
    'period_end', b.period_end, 'balance', public.credit_balance(p_org));
end $$;

revoke execute on function public.stripe_sync_subscription(uuid, text, public.billing_interval, integer, text, public.subscription_status, timestamptz, timestamptz, boolean) from public, anon, authenticated;
