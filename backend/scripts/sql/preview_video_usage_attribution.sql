-- Read-only preview of backfill_video_usage_attribution.sql: per org, how many
-- unattributed video-analysis rows / tokens the backfill would attribute and
-- how many would stay Unattributed. SELECT only; safe on production.
with unowned as (
  select
    e.id,
    e.org_id,
    e.job_id,
    e.total_tokens,
    coalesce(
      case when (e.metadata->>'proofId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then (e.metadata->>'proofId')::uuid end,
      case when e.request_id ~* '^whisper:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
           then substring(e.request_id from '(?i)^whisper:([0-9a-f-]{36})')::uuid end,
      case when e.request_id ~* '(^|:)video:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
           then substring(e.request_id from '(?i)(?:^|:)video:([0-9a-f-]{36})')::uuid end
    ) as proof_id,
    case when (e.metadata->>'videoId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (e.metadata->>'videoId')::uuid end as video_id,
    coalesce(
      case when (e.metadata->>'partyId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then (e.metadata->>'partyId')::uuid end,
      case when e.request_id ~* ':safety:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
           then substring(e.request_id from '(?i):safety:([0-9a-f-]{36})')::uuid end
    ) as party_hint,
    case when (e.metadata->>'triggeredBy') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then (e.metadata->>'triggeredBy')::uuid end as triggered_by
  from public.token_usage_events e
  where e.user_id is null
    and e.feature = 'video_analysis'
),
resolved as (
  select
    u.id,
    u.org_id,
    u.total_tokens,
    coalesce(
      vv.uploader_id,          -- 1. the clip's uploader
      jp.created_by,           -- 2. teammate who opened the capture link (Field Capture)
      j.owner_id,              -- 3. job owner
      j.created_by,            -- 4. job creator
      u.triggered_by           -- 5. org admin who triggered the run
    ) as user_id
  from unowned u
  left join lateral (
    select v.uploader_id, v.party_id, v.job_id
    from public.verification_videos v
    where v.org_id = u.org_id
      and (v.id = u.video_id or v.proof_id = u.proof_id)
    order by (v.id is not distinct from u.video_id) desc, v.uploader_id nulls last, v.created_at
    limit 1
  ) vv on true
  left join public.job_proofs p
    on p.id = u.proof_id and p.org_id = u.org_id
  left join public.job_parties jp
    on jp.id = coalesce(vv.party_id, p.party_id, u.party_hint) and jp.org_id = u.org_id
  left join public.crm_jobs j
    on j.id = coalesce(u.job_id, vv.job_id, p.job_id) and j.org_id = u.org_id
)
select
  r.org_id,
  count(*) as unattributed_rows_before,
  coalesce(sum(r.total_tokens), 0) as unattributed_tokens_before,
  count(*) filter (where r.user_id is not null) as rows_backfilled,
  coalesce(sum(r.total_tokens) filter (where r.user_id is not null), 0) as tokens_backfilled,
  count(*) filter (where r.user_id is null) as rows_still_unattributed,
  coalesce(sum(r.total_tokens) filter (where r.user_id is null), 0) as tokens_still_unattributed
from resolved r
group by r.org_id
order by r.org_id;
