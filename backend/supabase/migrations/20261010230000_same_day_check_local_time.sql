-- Recompute the stored "same_day" integrity check in the org's local timezone.
--
-- The check used to compare the UTC calendar day of captured_at with work_date
-- (a local day), so every evening clip in the Americas was flagged as "filmed
-- on the wrong day". Only rows whose capture is on the filed day in local time
-- (or within 4h after local midnight of the next day) are rewritten to pass;
-- genuine mismatches are left as they are. Idempotent.
with fixed as (
  select p.id,
         (p.captured_at at time zone coalesce(nullif(o.daily_job_report_timezone, ''), 'America/New_York')) as local_ts
  from public.job_proofs p
  join public.orgs o on o.id = p.org_id
  where p.captured_at is not null
    and jsonb_typeof(p.checks) = 'array'
    and exists (
      select 1 from jsonb_array_elements(p.checks) c
      where c->>'key' = 'same_day' and c->>'verdict' = 'fail'
    )
), ok as (
  select f.id, f.local_ts from fixed f join public.job_proofs p on p.id = f.id
  where f.local_ts::date = p.work_date
     or (f.local_ts::date = p.work_date + 1 and extract(hour from f.local_ts) < 4)
)
update public.job_proofs p
set checks = (
  select jsonb_agg(
    case when c->>'key' = 'same_day'
      then jsonb_build_object(
        'key', 'same_day',
        'verdict', 'pass',
        'detail', 'Filmed on ' || to_char(ok.local_ts, 'Mon FMDD') || '.'
      )
      else c end
    order by ord)
  from jsonb_array_elements(p.checks) with ordinality as e(c, ord)
)
from ok
where p.id = ok.id;
