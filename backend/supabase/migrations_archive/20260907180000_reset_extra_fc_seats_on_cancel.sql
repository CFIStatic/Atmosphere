-- Environments that already applied 20260907160000 still need cancel to
-- drop extra_fc_seats. create or replace is safe to re-run.

create or replace function public.stripe_cancel_subscription(p_org uuid)
returns void language plpgsql security definer
set search_path to 'public','pg_temp' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  insert into public.credit_ledger (org_id, entry_type, bucket, amount_nanos, description, lot_id)
  select org_id, 'expiration', 'plan', -remaining_nanos, 'Subscription ended', id
  from public.credit_lots where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

  update public.credit_lots set remaining_nanos = 0
   where org_id = p_org and bucket = 'plan' and remaining_nanos > 0;

  update public.org_billing
     set plan_code = 'free', seats = 1, status = 'canceled',
         stripe_subscription_id = null, cancel_at_period_end = false,
         extra_fc_seats = 0
   where org_id = p_org;
end $$;
