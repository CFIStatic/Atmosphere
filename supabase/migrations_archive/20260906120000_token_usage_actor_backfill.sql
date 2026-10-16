-- Attribute recent unattributed video-analysis token rows to the seat that
-- caused them (uploader, party inviter, job owner / creator), and copy
-- estimated spend from verification_ai_costs when the ledger still has $0.
--
-- Write-path attribution is the source of truth going forward. This backfill
-- is scoped to the last 90 days and only fills user_id / price_nanos when we
-- can join a real owner. Truly anonymous rows stay Unattributed.
--
-- Join verification_videos only by the event's own video (metadata.videoId or
-- the matched cost row's video_id). Never by job_id — a job can have many
-- clips, and a wrong uploader would be permanent.

update public.verification_ai_costs c
set user_id = attributed.user_id
from (
  select distinct on (c2.id)
    c2.id,
    coalesce(v.uploader_id, p.created_by, j.owner_id, j.created_by) as user_id
  from public.verification_ai_costs c2
  left join public.verification_videos v
    on v.id = c2.video_id
    and v.org_id = c2.org_id
  left join public.job_parties p
    on p.id = v.party_id
    and p.org_id = c2.org_id
  left join public.crm_jobs j
    on j.id = coalesce(c2.job_id, v.job_id)
    and j.org_id = c2.org_id
  where c2.user_id is null
    and c2.created_at >= now() - interval '90 days'
  order by c2.id
) attributed
where c.id = attributed.id
  and c.user_id is null
  and attributed.user_id is not null;

update public.token_usage_events e
set user_id = attributed.user_id
from (
  select distinct on (e2.id)
    e2.id,
    coalesce(
      c.user_id,
      v.uploader_id,
      p.created_by,
      j.owner_id,
      j.created_by
    ) as user_id
  from public.token_usage_events e2
  left join public.verification_ai_costs c
    on c.org_id = e2.org_id
    and (
      (
        (e2.metadata->>'analysisRunId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and c.analysis_run_id = (e2.metadata->>'analysisRunId')::uuid
      )
      or e2.request_id = 'verification:' || c.id::text
    )
  left join public.verification_videos v
    on v.org_id = e2.org_id
    and v.id = coalesce(
      case
        when (e2.metadata->>'videoId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then (e2.metadata->>'videoId')::uuid
      end,
      c.video_id
    )
  left join public.job_parties p
    on p.id = v.party_id
    and p.org_id = e2.org_id
  left join public.crm_jobs j
    on j.id = coalesce(e2.job_id, v.job_id)
    and j.org_id = e2.org_id
  where e2.user_id is null
    and e2.feature = 'video_analysis'
    and e2.created_at >= now() - interval '90 days'
  order by e2.id, v.uploader_id nulls last, p.created_by nulls last, j.owner_id nulls last
) attributed
where e.id = attributed.id
  and e.user_id is null
  and attributed.user_id is not null;

update public.token_usage_events e
set price_nanos = greatest(round(c.estimated_cost_usd * 1000000000)::bigint, 0)
from public.verification_ai_costs c
where e.price_nanos = 0
  and e.feature = 'video_analysis'
  and e.created_at >= now() - interval '90 days'
  and c.org_id = e.org_id
  and c.estimated_cost_usd is not null
  and c.estimated_cost_usd > 0
  and (
    (
      (e.metadata->>'analysisRunId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and c.analysis_run_id = (e.metadata->>'analysisRunId')::uuid
    )
    or e.request_id = 'verification:' || c.id::text
  );
