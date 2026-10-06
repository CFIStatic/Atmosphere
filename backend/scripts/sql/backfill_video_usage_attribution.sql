-- Backfill: attribute stored video-analysis token rows to the person who
-- caused them, using the same chain the app now uses on write
-- (metering/usageAttribution.ts → resolveUsageActor) and on read
-- (tokenUsage.ts → attributeUnownedRows, Billing › By employee):
--
--   1. the clip's uploader      verification_videos.uploader_id
--   2. capture-link inviter     job_parties.created_by (Field Capture: the person filming)
--   3. job owner                crm_jobs.owner_id
--   4. job creator              crm_jobs.created_by
--   5. triggering org admin     metadata.triggeredBy (re-analyse button; new rows only)
--
-- Clip ids come from the row itself: metadata.proofId / metadata.videoId, or
-- the request id (`<source>:video:<proofId>:…`, `whisper:<proofId>`, legacy
-- `safety_vision:safety:<partyId>:…`). Never joined by job alone to a clip —
-- a job has many clips and a wrong uploader would be permanent.
--
-- Only touches rows with user_id IS NULL and feature = 'video_analysis'.
-- Idempotent: a second run finds nothing to do. No amounts are changed.
--
-- NOT a migration on purpose: it must not run on deploy. Run by hand after
-- review:
--
--   psql "$DATABASE_URL"
--   => \i backend/scripts/sql/backfill_video_usage_attribution.sql
--   => COMMIT;      -- after reading the before / after counts (or ROLLBACK;)
--
-- The script opens a transaction and leaves it OPEN; nothing is kept until
-- you type COMMIT. `psql -f` on its own is therefore a dry run: the open
-- transaction is rolled back when psql exits.
--
-- Read-only preview: backend/scripts/sql/preview_video_usage_attribution.sql

begin;

create temp table _video_usage_attribution on commit drop as
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
select r.id, r.org_id, r.total_tokens, r.user_id from resolved r;

-- Before
select
  org_id,
  count(*) as unattributed_rows_before,
  sum(total_tokens) as unattributed_tokens_before,
  count(*) filter (where user_id is not null) as rows_to_attribute,
  coalesce(sum(total_tokens) filter (where user_id is not null), 0) as tokens_to_attribute
from _video_usage_attribution
group by org_id
order by org_id;

update public.token_usage_events e
set user_id = a.user_id
from _video_usage_attribution a
where e.id = a.id
  and e.user_id is null
  and a.user_id is not null;

-- After: what is still unattributed video analysis, per org.
select
  e.org_id,
  count(*) as unattributed_rows_after,
  coalesce(sum(e.total_tokens), 0) as unattributed_tokens_after
from public.token_usage_events e
where e.user_id is null
  and e.feature = 'video_analysis'
group by e.org_id
order by e.org_id;

-- Review the counts above, then:  COMMIT;   or   ROLLBACK;
