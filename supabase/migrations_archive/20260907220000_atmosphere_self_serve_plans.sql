-- Starter / Work Verification / Scale: persist the org's Atmosphere plan
-- and included Field Capture seats. Allowed seats = included + extra_fc_seats.
-- Railway does not run migrations on boot; apply via
-- backend/scripts/applyAtmosphereSelfServePlans.mjs on deploy.

alter table public.org_billing
  add column if not exists atmosphere_plan_code text not null default 'work_verification';

alter table public.org_billing
  add column if not exists included_fc_seats integer not null default 3
    check (included_fc_seats >= 0);

comment on column public.org_billing.atmosphere_plan_code is
  'Self-serve Atmosphere plan: starter | work_verification | scale.';

comment on column public.org_billing.included_fc_seats is
  'Field Capture seats included with the Atmosphere plan (1 / 3 / 10). Allowed = included_fc_seats + extra_fc_seats.';

create or replace function private.field_capture_seats_allowed(p_org uuid)
returns integer
language plpgsql
stable
as $$
declare
  v_status text;
  v_extra integer := 0;
  v_included integer := 3;
begin
  begin
    select b.status::text,
           coalesce(b.extra_fc_seats, 0),
           coalesce(b.included_fc_seats, 3)
      into v_status, v_extra, v_included
    from public.org_billing b
    where b.org_id = p_org;
  exception
    when undefined_column then
      begin
        select b.status::text, coalesce(b.extra_fc_seats, 0)
          into v_status, v_extra
        from public.org_billing b
        where b.org_id = p_org;
        v_included := 3;
      exception
        when undefined_column then
          select b.status::text into v_status
          from public.org_billing b
          where b.org_id = p_org;
          v_extra := 0;
          v_included := 3;
      end;
  end;
  if not found then
    return 3;
  end if;
  if v_status is null or v_status in ('active', 'trialing', 'past_due', 'comped') then
    return greatest(v_included, 0) + greatest(v_extra, 0);
  end if;
  return 0;
end;
$$;
