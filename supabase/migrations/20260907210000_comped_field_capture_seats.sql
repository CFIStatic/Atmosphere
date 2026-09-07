-- Complimentary / founder orgs use org_billing.status = 'comped'.
-- Seat allowance must match application-level isWorkVerificationEntitled.

create or replace function private.field_capture_seats_allowed(p_org uuid)
returns integer
language plpgsql
stable
as $$
declare
  v_status text;
  v_extra integer := 0;
begin
  begin
    select b.status::text, coalesce(b.extra_fc_seats, 0)
      into v_status, v_extra
    from public.org_billing b
    where b.org_id = p_org;
  exception
    when undefined_column then
      select b.status::text into v_status
      from public.org_billing b
      where b.org_id = p_org;
      v_extra := 0;
  end;
  if not found then
    return 3;
  end if;
  if v_status is null or v_status in ('active', 'trialing', 'past_due', 'comped') then
    return 3 + greatest(v_extra, 0);
  end if;
  return 0;
end;
$$;
