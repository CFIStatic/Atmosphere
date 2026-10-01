-- Allowance totals and credit draws are computed in the database.
-- PostgREST's db-max-rows cap (default 1_000) silently truncates a paged
-- select, so summing rows in the API under-counts spend and credits.
-- These functions are service-role only.

create or replace function public.ai_credit_balance(p_org uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(delta_nanos), 0)::bigint
  from public.ai_credit_ledger
  where org_id = p_org;
$$;

create or replace function public.ai_allowance_totals(
  p_org uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_window_start timestamptz
)
returns table (
  period_spend_nanos bigint,
  window_event_nanos bigint,
  window_allowance_nanos bigint,
  window_allocation_count bigint,
  credit_balance_nanos bigint,
  by_feature jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce((
      select sum(greatest(coalesce(cost_nanos, 0), 0))
      from public.token_usage_events
      where org_id = p_org
        and created_at >= p_period_start
        and created_at < p_period_end
    ), 0)::bigint,
    coalesce((
      select sum(greatest(coalesce(cost_nanos, 0), 0))
      from public.token_usage_events
      where org_id = p_org
        and created_at >= p_period_start
        and created_at < p_period_end
        and created_at >= p_window_start
    ), 0)::bigint,
    coalesce((
      select sum(greatest(allowance_nanos, 0))
      from public.ai_usage_allocations
      where org_id = p_org
        and created_at >= p_window_start
    ), 0)::bigint,
    coalesce((
      select count(*)
      from public.ai_usage_allocations
      where org_id = p_org
        and created_at >= p_window_start
    ), 0)::bigint,
    public.ai_credit_balance(p_org),
    coalesce((
      select jsonb_object_agg(feature, nanos)
      from (
        select feature::text as feature,
               sum(greatest(coalesce(cost_nanos, 0), 0))::bigint as nanos
        from public.token_usage_events
        where org_id = p_org
          and created_at >= p_period_start
          and created_at < p_period_end
        group by feature
      ) grouped
    ), '{}'::jsonb);
$$;

-- One locked statement: the credit consume is inserted only when the summed
-- balance covers the full draw. A short balance records the allowance portion
-- with credit_nanos = 0 and does not insert a consume, so the call is not
-- paid by credits.
create or replace function public.settle_ai_usage(
  p_org uuid,
  p_request_id text,
  p_cost_nanos bigint,
  p_allowance_nanos bigint,
  p_credit_nanos bigint,
  p_at timestamptz
)
returns table (
  applied boolean,
  credit_applied boolean,
  allowance_nanos bigint,
  credit_nanos bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.ai_usage_allocations%rowtype;
  v_balance bigint;
  v_credit bigint := greatest(coalesce(p_credit_nanos, 0), 0);
  v_allowance bigint := greatest(coalesce(p_allowance_nanos, 0), 0);
begin
  if p_request_id is null or length(btrim(p_request_id)) = 0 then
    raise exception 'request_id required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ai-credit-draw'), hashtext(p_org::text));

  select * into v_existing
  from public.ai_usage_allocations
  where org_id = p_org and request_id = p_request_id;

  if found then
    return query
      select true,
             v_existing.credit_nanos > 0,
             v_existing.allowance_nanos,
             v_existing.credit_nanos;
    return;
  end if;

  select public.ai_credit_balance(p_org) into v_balance;

  if v_credit > 0 and v_balance < v_credit then
    v_credit := 0;
  end if;

  insert into public.ai_usage_allocations (
    org_id, request_id, cost_nanos, allowance_nanos, credit_nanos, created_at
  ) values (
    p_org,
    p_request_id,
    greatest(coalesce(p_cost_nanos, 0), 0),
    v_allowance,
    v_credit,
    coalesce(p_at, now())
  );

  if v_credit > 0 then
    insert into public.ai_credit_ledger (
      org_id, delta_nanos, kind, request_id, note, created_at
    ) values (
      p_org, -v_credit, 'consume', p_request_id, 'AI usage', coalesce(p_at, now())
    );
  end if;

  return query select true, v_credit > 0, v_allowance, v_credit;
end;
$$;

revoke all on function public.ai_credit_balance(uuid) from public, anon, authenticated;
revoke all on function public.ai_allowance_totals(uuid, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.settle_ai_usage(uuid, text, bigint, bigint, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_credit_balance(uuid) to service_role;
grant execute on function public.ai_allowance_totals(uuid, timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.settle_ai_usage(uuid, text, bigint, bigint, bigint, timestamptz) to service_role;

-- ai_budget_hold is server-write-only. Org members can update a clip, but
-- not clear the hold that keeps analysis queued. Column grants drop the
-- table-level UPDATE and re-grant every column except the hold. The trigger
-- rejects a hold change from any role other than the service role.
create or replace function private.job_proofs_guard_budget_hold()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.ai_budget_hold is distinct from old.ai_budget_hold
     or new.ai_budget_hold_reason is distinct from old.ai_budget_hold_reason
  then
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception 'ai_budget_hold is server-write-only' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists job_proofs_guard_budget_hold on public.job_proofs;
create trigger job_proofs_guard_budget_hold
  before update on public.job_proofs
  for each row
  execute function private.job_proofs_guard_budget_hold();

do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'job_proofs'
    and column_name not in ('ai_budget_hold', 'ai_budget_hold_reason');
  execute 'revoke update on table public.job_proofs from public, anon, authenticated';
  execute format('grant update (%s) on table public.job_proofs to authenticated', cols);
  execute 'grant update on table public.job_proofs to service_role';
end $$;
