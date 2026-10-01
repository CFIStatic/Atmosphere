-- Boot queue for room backfill. Analyzed clips with no room rows and no
-- stored roomSegments key. A user-corrected clip has rows, so it is not
-- selected. An empty segmentation still stores roomSegments: [] and drops
-- out of the queue. set_proof_room_segments (20261001161000) writes that key
-- without replacing the rest of ai_findings.

create or replace function public.proofs_awaiting_room_backfill(
  p_limit int,
  p_job_id uuid default null,
  p_org_id uuid default null
)
returns table (id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id
  from public.job_proofs p
  where p.deleted_at is null
    and p.narration_status in ('done', 'skipped')
    and (p_job_id is null or p.job_id = p_job_id)
    and (p_org_id is null or p.org_id = p_org_id)
    and not exists (
      select 1 from public.clip_room_segments s where s.proof_id = p.id
    )
    and not (coalesce(p.ai_findings, '{}'::jsonb) ? 'roomSegments')
  order by p.created_at asc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.proofs_awaiting_room_backfill(int, uuid, uuid) from public;
revoke all on function public.proofs_awaiting_room_backfill(int, uuid, uuid) from anon;
revoke all on function public.proofs_awaiting_room_backfill(int, uuid, uuid) from authenticated;
grant execute on function public.proofs_awaiting_room_backfill(int, uuid, uuid) to service_role;
