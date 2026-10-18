-- ============================================================================
-- Internal Growth Metrics — global AI token usage
-- ============================================================================
-- token_usage_events is the durable customer ledger (org + user + model per
-- call). Metering analytics reads private.ai_usage_events for cost; this RPC
-- exposes token counts for staff so Internal Growth Metrics can show truthful
-- totals, by customer, by user, and by model. Empty windows return empty
-- arrays — no fabricated history.
-- ============================================================================

create index if not exists token_usage_events_created_at
  on public.token_usage_events (created_at desc);

create or replace function public.admin_token_usage_analytics(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'auth', 'pg_temp'
as $$
declare
  v_scope public.analytics_scope;
begin
  select scope into v_scope from public.analytics_staff where user_id = auth.uid();
  if v_scope is null or v_scope < 'internal'::public.analytics_scope then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'range', jsonb_build_object(
      'from', p_from,
      'to', p_to
    ),
    'totals', (
      select jsonb_build_object(
        'eventCount', count(*)::int,
        'inputTokens', coalesce(sum(e.input_tokens), 0),
        'outputTokens', coalesce(sum(e.output_tokens), 0),
        'cacheTokens', coalesce(sum(e.cache_tokens), 0),
        'totalTokens', coalesce(sum(e.total_tokens), 0),
        'priceNanos', coalesce(sum(e.price_nanos), 0),
        'costNanos', coalesce(sum(e.cost_nanos), 0),
        'distinctOrgs', count(distinct e.org_id)::int,
        'distinctUsers', count(distinct e.user_id) filter (where e.user_id is not null)::int,
        'distinctModels', count(distinct e.model_id) filter (
          where e.model_id is not null and btrim(e.model_id) <> ''
        )::int
      )
      from public.token_usage_events e
      where e.created_at >= p_from and e.created_at < p_to
    ),
    'byCustomer', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select
          e.org_id as "orgId",
          o.name as "orgName",
          count(*)::int as "eventCount",
          coalesce(sum(e.input_tokens), 0) as "inputTokens",
          coalesce(sum(e.output_tokens), 0) as "outputTokens",
          coalesce(sum(e.cache_tokens), 0) as "cacheTokens",
          coalesce(sum(e.total_tokens), 0) as "totalTokens",
          coalesce(sum(e.price_nanos), 0) as "priceNanos",
          count(distinct e.user_id) filter (where e.user_id is not null)::int as "distinctUsers",
          count(distinct e.model_id) filter (
            where e.model_id is not null and btrim(e.model_id) <> ''
          )::int as "distinctModels"
        from public.token_usage_events e
        join public.orgs o on o.id = e.org_id
        where e.created_at >= p_from and e.created_at < p_to
        group by e.org_id, o.name
        order by sum(e.total_tokens) desc, o.name asc
        limit 200
      ) t
    ),
    'byUser', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select
          e.user_id as "userId",
          coalesce(
            nullif(btrim(pr.full_name), ''),
            split_part(coalesce(au.email, ''), '@', 1),
            'Unattributed'
          ) as "userName",
          au.email as "email",
          e.org_id as "orgId",
          o.name as "orgName",
          count(*)::int as "eventCount",
          coalesce(sum(e.input_tokens), 0) as "inputTokens",
          coalesce(sum(e.output_tokens), 0) as "outputTokens",
          coalesce(sum(e.cache_tokens), 0) as "cacheTokens",
          coalesce(sum(e.total_tokens), 0) as "totalTokens",
          coalesce(sum(e.price_nanos), 0) as "priceNanos"
        from public.token_usage_events e
        join public.orgs o on o.id = e.org_id
        left join public.profiles pr on pr.id = e.user_id
        left join auth.users au on au.id = e.user_id
        where e.created_at >= p_from
          and e.created_at < p_to
          and e.user_id is not null
        group by e.user_id, pr.full_name, au.email, e.org_id, o.name
        order by sum(e.total_tokens) desc, coalesce(au.email, '') asc
        limit 200
      ) t
    ),
    'byModel', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select
          coalesce(nullif(btrim(e.model_id), ''), '(unknown)') as "model",
          count(*)::int as "eventCount",
          coalesce(sum(e.input_tokens), 0) as "inputTokens",
          coalesce(sum(e.output_tokens), 0) as "outputTokens",
          coalesce(sum(e.cache_tokens), 0) as "cacheTokens",
          coalesce(sum(e.total_tokens), 0) as "totalTokens",
          coalesce(sum(e.price_nanos), 0) as "priceNanos",
          count(distinct e.org_id)::int as "distinctOrgs",
          count(distinct e.user_id) filter (where e.user_id is not null)::int as "distinctUsers"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
        group by coalesce(nullif(btrim(e.model_id), ''), '(unknown)')
        order by sum(e.total_tokens) desc, 1 asc
        limit 100
      ) t
    ),
    'byFeature', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select
          e.feature::text as "feature",
          count(*)::int as "eventCount",
          coalesce(sum(e.total_tokens), 0) as "totalTokens",
          coalesce(sum(e.price_nanos), 0) as "priceNanos"
        from public.token_usage_events e
        where e.created_at >= p_from and e.created_at < p_to
        group by e.feature
        order by sum(e.total_tokens) desc
      ) t
    )
  );
end;
$$;

comment on function public.admin_token_usage_analytics(timestamptz, timestamptz) is
  'Internal Growth Metrics: global token_usage_events totals by customer, user, and model.';

revoke all on function public.admin_token_usage_analytics(timestamptz, timestamptz) from public;
grant execute on function public.admin_token_usage_analytics(timestamptz, timestamptz)
  to authenticated, service_role;
