-- Internal staff website: one-org account file (members, jobs, usage).
-- Internal analytics_staff scope only — names customers and their people.

create or replace function public.analytics_account_detail(
  p_org_id uuid,
  p_from   timestamptz default (now() - interval '30 days'),
  p_to     timestamptz default now()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org public.orgs%rowtype;
begin
  perform private.require_analytics('internal');

  select * into v_org from public.orgs where id = p_org_id;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'account', (
      select jsonb_build_object(
        'org_id', o.id,
        'org_name', o.name,
        'created_at', o.created_at,
        'plan_code', coalesce(b.plan_code, 'free'),
        'plan_name', coalesce(p.name, 'Free'),
        'billing_interval', coalesce(b.billing_interval::text, 'monthly'),
        'status', coalesce(b.status::text, 'active'),
        'seats', coalesce(b.seats, 0),
        'members', (select count(*) from public.org_members m where m.org_id = o.id),
        'mrr_cents', coalesce(private.plan_mrr_cents(b.plan_code, b.billing_interval, b.seats, b.status), 0)::bigint,
        'arr_cents', coalesce(private.plan_mrr_cents(b.plan_code, b.billing_interval, b.seats, b.status), 0)::bigint * 12,
        'revenue_in_range_cents', (
          select coalesce(sum(amount_cents), 0) from public.payments pay
          where pay.org_id = o.id and pay.status = 'succeeded'
            and pay.created_at >= p_from and pay.created_at < p_to
        ),
        'credit_spend_cents', (
          select round(coalesce(sum(price_nanos), 0) / 10000000.0, 2)
          from public.usage_events u
          where u.org_id = o.id and u.created_at >= p_from and u.created_at < p_to
        ),
        'active_hours', (
          select round(coalesce(sum(active_ms), 0) / 3600000.0, 2)
          from public.feature_usage_sessions s
          where s.org_id = o.id and s.last_seen_at >= p_from and s.last_seen_at < p_to
        ),
        'top_feature', (
          select f.label from public.feature_usage_sessions s
          join public.feature_catalog f on f.key = s.feature_key
          where s.org_id = o.id and s.last_seen_at >= p_from and s.last_seen_at < p_to
          group by f.label order by sum(s.active_ms) desc limit 1
        ),
        'last_active_at', (
          select max(s.last_seen_at) from public.feature_usage_sessions s where s.org_id = o.id
        )
      )
      from public.orgs o
      left join public.org_billing b on b.org_id = o.id
      left join public.billing_plans p on p.code = b.plan_code
      where o.id = p_org_id
    ),
    'members', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.created_at), '[]'::jsonb)
      from (
        select
          m.user_id as "userId",
          pr.email,
          pr.full_name as "fullName",
          m.role::text as role,
          m.work_type::text as "workType",
          m.status,
          m.created_at as "createdAt"
        from public.org_members m
        left join public.profiles pr on pr.id = m.user_id
        where m.org_id = p_org_id
      ) t
    ),
    'jobs', jsonb_build_object(
      'total', (select count(*) from public.crm_jobs j where j.org_id = p_org_id),
      'byStatus', (
        select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        from (
          select j.status::text as status, count(*)::int as count
          from public.crm_jobs j
          where j.org_id = p_org_id
          group by j.status
          order by count(*) desc
        ) t
      ),
      'recent', (
        select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        from (
          select
            j.id,
            j.title,
            j.status::text as status,
            j.work_type::text as "workType",
            j.job_number as "jobNumber",
            j.created_at as "createdAt"
          from public.crm_jobs j
          where j.org_id = p_org_id
          order by j.created_at desc
          limit 25
        ) t
      )
    ),
    'features', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select
          s.feature_key as "featureKey",
          coalesce(f.label, s.feature_key) as label,
          round(coalesce(sum(s.active_ms), 0) / 3600000.0, 2) as "activeHours",
          count(*)::int as sessions
        from public.feature_usage_sessions s
        left join public.feature_catalog f on f.key = s.feature_key
        where s.org_id = p_org_id
          and s.last_seen_at >= p_from
          and s.last_seen_at < p_to
        group by s.feature_key, f.label
        order by sum(s.active_ms) desc
        limit 20
      ) t
    )
  );
end;
$$;

revoke all on function public.analytics_account_detail(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_account_detail(uuid, timestamptz, timestamptz) to authenticated, service_role;
