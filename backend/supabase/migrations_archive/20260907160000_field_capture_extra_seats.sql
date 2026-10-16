-- Field Capture extra seats on Work Verification ($100/mo each beyond 3 included).
-- Railway does not run migrations on boot; apply via
-- backend/scripts/applyFieldCaptureExtraSeats.mjs on deploy.

alter table public.org_billing
  add column if not exists extra_fc_seats integer not null default 0
    check (extra_fc_seats >= 0);

comment on column public.org_billing.extra_fc_seats is
  'Stripe quantity of field_capture_extra_seat. Allowed Field Capture accounts = 3 + extra_fc_seats.';

-- Paid extras die with Work Verification. The original cancel RPC predates
-- this column and would otherwise leave leftover seats on a canceled org.
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
