-- Atmosphere Analytics: product-health report and the minimum tracking it needs.
--
-- Staff-only Internal site (Railway service "Internal Growth Metrics") now
-- leads with weekly recorded hours per paying seat and four health signals:
-- upload reliability, upload -> analysis-ready time, evidence delivered, and
-- Ask quality. Most of that is already in the database. Two facts were not:
--
--   1. When an upload STARTED. job_proofs only exists once a film is filed,
--      so a film that never arrives leaves no row. capture_upload_attempts
--      records the start (signed URL minted), each retry, the finish (proof
--      filed) and the last upload error code. No file names, no content.
--   2. How an Ask turn ENDED and how long it took. Timings were only logged.
--      ask_turn_events stores outcome, total and first-token latency, and the
--      model id. Never the question, the answer, a transcript or a name.
--
-- Both tables are written by the BFF with the service role and are not
-- readable or writable by anon / authenticated. The report follows the
-- 20261002193000_internal_analytics_actor pattern: SECURITY DEFINER, gated by
-- private.require_analytics() (analytics_staff row of the actor the BFF sends),
-- EXECUTE for service_role only.
--
-- Safe to re-run: every statement is IF NOT EXISTS / OR REPLACE / re-grant.

create table if not exists public.capture_upload_attempts (
  org_id          uuid        not null references public.orgs(id) on delete cascade,
  upload_key      text        not null check (char_length(upload_key) between 1 and 500),
  job_id          uuid,
  started_at      timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  attempts        integer     not null default 1 check (attempts >= 1),
  completed_at    timestamptz,
  failed_at       timestamptz,
  last_error_code text        check (last_error_code is null or char_length(last_error_code) <= 64),
  primary key (org_id, upload_key)
);

create index if not exists capture_upload_attempts_started_idx
  on public.capture_upload_attempts (started_at);

comment on table public.capture_upload_attempts is
  'One row per Field Capture upload (org + storage path). Start, retries, finish, last error code. Written by the BFF; read only by analytics_product_health.';

alter table public.capture_upload_attempts enable row level security;
revoke all on table public.capture_upload_attempts from public, anon, authenticated;
grant select, insert, update on table public.capture_upload_attempts to service_role;

create table if not exists public.ask_turn_events (
  id          bigint generated always as identity primary key,
  org_id      uuid        not null references public.orgs(id) on delete cascade,
  surface     text        not null default 'job' check (surface in ('job', 'progress_share')),
  outcome     text        not null check (outcome in ('answered', 'error', 'refused', 'stopped')),
  error_code  text        check (error_code is null or char_length(error_code) <= 64),
  total_ms    integer     not null check (total_ms >= 0),
  ttft_ms     integer     check (ttft_ms is null or ttft_ms >= 0),
  model       text        check (model is null or char_length(model) <= 80),
  created_at  timestamptz not null default now()
);

create index if not exists ask_turn_events_created_idx
  on public.ask_turn_events (created_at);

comment on table public.ask_turn_events is
  'One row per Ask turn: outcome, latency, model id. Never question or answer text. Written by the BFF; read only by analytics_product_health.';

alter table public.ask_turn_events enable row level security;
revoke all on table public.ask_turn_events from public, anon, authenticated;
grant select, insert on table public.ask_turn_events to service_role;

-- Upload lifecycle writer. One statement per event so concurrent retries
-- cannot lose an attempt count.
create or replace function public.record_capture_upload(
  p_org        uuid,
  p_upload_key text,
  p_event      text,
  p_job        uuid default null,
  p_error_code text default null
) returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := left(btrim(coalesce(p_upload_key, '')), 500);
  v_err text := nullif(left(btrim(coalesce(p_error_code, '')), 64), '');
begin
  if p_org is null or v_key = '' then
    return;
  end if;

  if p_event = 'start' then
    insert into public.capture_upload_attempts as a (org_id, upload_key, job_id)
    values (p_org, v_key, p_job)
    on conflict (org_id, upload_key) do update
      set attempts        = a.attempts + 1,
          last_attempt_at = now(),
          job_id          = coalesce(a.job_id, excluded.job_id);
  elsif p_event = 'touch' then
    insert into public.capture_upload_attempts as a (org_id, upload_key, job_id)
    values (p_org, v_key, p_job)
    on conflict (org_id, upload_key) do update
      set last_attempt_at = now(),
          job_id          = coalesce(a.job_id, excluded.job_id);
  elsif p_event = 'complete' then
    insert into public.capture_upload_attempts as a (org_id, upload_key, job_id, completed_at)
    values (p_org, v_key, p_job, now())
    on conflict (org_id, upload_key) do update
      set completed_at    = coalesce(a.completed_at, now()),
          last_attempt_at = now(),
          job_id          = coalesce(a.job_id, excluded.job_id);
  elsif p_event = 'fail' then
    insert into public.capture_upload_attempts as a (org_id, upload_key, job_id, failed_at, last_error_code)
    values (p_org, v_key, p_job, now(), coalesce(v_err, 'unknown'))
    on conflict (org_id, upload_key) do update
      set failed_at       = now(),
          last_error_code = coalesce(v_err, 'unknown'),
          last_attempt_at = now(),
          job_id          = coalesce(a.job_id, excluded.job_id);
  else
    raise exception 'unknown capture upload event %', p_event using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.record_capture_upload(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.record_capture_upload(uuid, text, text, uuid, text) to service_role;

-- The report. Weeks start Monday 00:00 UTC. The current week is returned and
-- flagged partial. Health windows are the trailing 28 days and the 28 days
-- before that, so every number has its prior-period comparison.
create or replace function public.analytics_product_health(p_weeks integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_weeks      integer := greatest(4, least(coalesce(p_weeks, 12), 52));
  v_now        timestamptz := now();
  v_this_week  timestamptz := date_trunc('week', v_now at time zone 'UTC') at time zone 'UTC';
  v_from       timestamptz := v_this_week - make_interval(weeks => v_weeks);
  v_cur_from   timestamptz := v_now - interval '28 days';
  v_prev_from  timestamptz := v_now - interval '56 days';
  v_series     jsonb;
  v_uploads    jsonb;
  v_analysis   jsonb;
  v_evidence   jsonb;
  v_ask        jsonb;
begin
  perform private.require_analytics('investor');

  -- North star: recorded hours (job_proofs.duration_seconds, by received_at)
  -- from orgs paying at the end of the week, over the seats those orgs pay for.
  -- "Paying" = latest org_billing_events row with mrr_cents > 0 and status
  -- active or past_due. Trials are not paying seats.
  with weeks as (
    select ws,
           least(ws + interval '7 days', v_now) as we,
           (ws + interval '7 days') > v_now     as partial
    from generate_series(v_from, v_this_week, interval '1 week') as ws
  ),
  paying as (
    select w.ws, o.id as org_id, e.seats
    from weeks w
    cross join public.orgs o
    cross join lateral (
      select ev.seats, ev.status, ev.mrr_cents
      from public.org_billing_events ev
      where ev.org_id = o.id and ev.effective_at <= w.we
      order by ev.effective_at desc, ev.id desc
      limit 1
    ) e
    where e.mrr_cents > 0 and e.status in ('active', 'past_due')
  ),
  seat_weeks as (
    select ws, sum(greatest(seats, 0))::bigint as seats, count(*)::bigint as orgs
    from paying group by ws
  ),
  proof_weeks as (
    select w.ws,
           coalesce(sum(p.duration_seconds), 0) / 3600.0 as hours_all,
           coalesce(sum(p.duration_seconds) filter (where pa.org_id is not null), 0) / 3600.0 as hours_paying,
           count(p.id)::bigint as films
    from weeks w
    left join public.job_proofs p
      on p.received_at >= w.ws and p.received_at < w.ws + interval '7 days'
    left join paying pa on pa.ws = w.ws and pa.org_id = p.org_id
    group by w.ws
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'week_start',     w.ws,
           'partial',        w.partial,
           'paying_seats',   coalesce(s.seats, 0),
           'paying_orgs',    coalesce(s.orgs, 0),
           'hours_paying',   round(coalesce(pw.hours_paying, 0)::numeric, 3),
           'hours_all',      round(coalesce(pw.hours_all, 0)::numeric, 3),
           'films',          coalesce(pw.films, 0),
           'hours_per_seat', case when coalesce(s.seats, 0) > 0
                               then round((pw.hours_paying / s.seats)::numeric, 3) end
         ) order by w.ws), '[]'::jsonb)
    into v_series
  from weeks w
  left join seat_weeks s on s.ws = w.ws
  left join proof_weeks pw on pw.ws = w.ws;

  -- Upload reliability. "Settled" excludes uploads still in flight (no
  -- finish, no error, last activity under 24 h ago).
  with u as (
    select a.*,
           case when a.started_at >= v_cur_from then 'cur'
                when a.started_at >= v_prev_from then 'prev' end as period,
           (a.completed_at is null and a.failed_at is null
             and a.last_attempt_at > v_now - interval '24 hours') as in_flight
    from public.capture_upload_attempts a
    where a.started_at >= v_prev_from
  ),
  agg as (
    select period,
           count(*)                                                        as started,
           count(*) filter (where completed_at is not null)                as completed,
           count(*) filter (where completed_at is null and failed_at is not null) as failed,
           count(*) filter (where completed_at is null and failed_at is null and not in_flight) as abandoned,
           count(*) filter (where in_flight)                               as in_flight,
           count(*) filter (where attempts > 1)                            as retried,
           count(*) filter (where attempts > 1 and completed_at is null and in_flight) as retrying
    from u where period is not null group by period
  ),
  errs as (
    select coalesce(jsonb_agg(jsonb_build_object('code', code, 'count', n) order by n desc, code), '[]'::jsonb) as top
    from (
      select last_error_code as code, count(*) as n
      from u
      where period = 'cur' and completed_at is null and last_error_code is not null
      group by last_error_code
      order by count(*) desc
      limit 5
    ) e
  )
  select jsonb_build_object(
    'tracking_since', (select min(started_at) from public.capture_upload_attempts),
    'current',  (select to_jsonb(agg) - 'period' from agg where period = 'cur'),
    'prior',    (select to_jsonb(agg) - 'period' from agg where period = 'prev'),
    'top_errors', (select top from errs)
  ) into v_uploads;

  -- Upload -> analysis-ready: job_proofs.received_at to analysed_at for films
  -- whose analysis finished (analysis_status = 'done').
  with p as (
    select received_at,
           extract(epoch from (analysed_at - received_at)) as secs,
           analysis_status,
           case when received_at >= v_cur_from then 'cur'
                when received_at >= v_prev_from then 'prev' end as period
    from public.job_proofs
    where received_at >= least(v_prev_from, v_from)
  ),
  per as (
    select period,
           count(*)                                                           as received,
           count(*) filter (where analysis_status = 'done' and secs >= 0)     as analysed,
           count(*) filter (where analysis_status = 'failed')                 as failed,
           count(*) filter (where analysis_status is null or analysis_status not in ('done', 'failed')) as pending,
           percentile_cont(0.5) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as median_seconds,
           percentile_cont(0.9) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as p90_seconds
    from p where period is not null group by period
  ),
  wk as (
    select date_trunc('week', received_at at time zone 'UTC') at time zone 'UTC' as ws,
           count(*) filter (where analysis_status = 'done' and secs >= 0) as analysed,
           percentile_cont(0.5) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as median_seconds,
           percentile_cont(0.9) within group (order by secs) filter (where analysis_status = 'done' and secs >= 0) as p90_seconds
    from p where received_at >= v_from group by 1
  )
  select jsonb_build_object(
    'current', (select to_jsonb(per) - 'period' from per where period = 'cur'),
    'prior',   (select to_jsonb(per) - 'period' from per where period = 'prev'),
    'weekly',  coalesce((select jsonb_agg(jsonb_build_object(
                  'week_start', ws, 'analysed', analysed,
                  'median_seconds', round(median_seconds::numeric, 1),
                  'p90_seconds', round(p90_seconds::numeric, 1)) order by ws) from wk), '[]'::jsonb)
  ) into v_analysis;

  -- Evidence delivered.
  select jsonb_build_object(
    'current', jsonb_build_object(
      'proofs_analysed',   (select count(*) from public.job_proofs where analysis_status = 'done' and analysed_at >= v_cur_from),
      'daily_reports_sent',(select count(*) from public.daily_job_reports where status = 'sent' and sent_at >= v_cur_from),
      'evidence_downloads',(select count(*) from public.evidence_downloads where created_at >= v_cur_from),
      'share_links_created',(select count(*) from public.verifier_shares where created_at >= v_cur_from),
      'share_links_opened',(select count(*) from public.verifier_shares where last_opened_at >= v_cur_from)),
    'prior', jsonb_build_object(
      'proofs_analysed',   (select count(*) from public.job_proofs where analysis_status = 'done' and analysed_at >= v_prev_from and analysed_at < v_cur_from),
      'daily_reports_sent',(select count(*) from public.daily_job_reports where status = 'sent' and sent_at >= v_prev_from and sent_at < v_cur_from),
      'evidence_downloads',(select count(*) from public.evidence_downloads where created_at >= v_prev_from and created_at < v_cur_from),
      'share_links_created',(select count(*) from public.verifier_shares where created_at >= v_prev_from and created_at < v_cur_from),
      'share_links_opened', null),
    'lifetime', jsonb_build_object(
      'share_links',        (select count(*) from public.verifier_shares),
      'share_link_opens',   (select coalesce(sum(open_count), 0) from public.verifier_shares))
  ) into v_evidence;

  -- Ask quality. Questions asked come from the stored turns
  -- (job_proof_questions). Outcomes and latency come from ask_turn_events.
  with t as (
    select outcome, total_ms, ttft_ms,
           case when created_at >= v_cur_from then 'cur'
                when created_at >= v_prev_from then 'prev' end as period
    from public.ask_turn_events
    where created_at >= v_prev_from
  ),
  per as (
    select period,
           count(*)                                           as turns,
           count(*) filter (where outcome = 'answered')       as answered,
           count(*) filter (where outcome = 'error')          as errors,
           count(*) filter (where outcome = 'refused')        as refused,
           count(*) filter (where outcome = 'stopped')        as stopped,
           percentile_cont(0.5) within group (order by total_ms) filter (where outcome = 'answered') as median_ms,
           percentile_cont(0.9) within group (order by total_ms) filter (where outcome = 'answered') as p90_ms,
           percentile_cont(0.5) within group (order by ttft_ms)  filter (where outcome = 'answered' and ttft_ms is not null) as median_ttft_ms
    from t where period is not null group by period
  )
  select jsonb_build_object(
    'tracking_since', (select min(created_at) from public.ask_turn_events),
    'questions', jsonb_build_object(
      'current', (select count(*) from public.job_proof_questions where created_at >= v_cur_from),
      'prior',   (select count(*) from public.job_proof_questions where created_at >= v_prev_from and created_at < v_cur_from),
      'orgs_current', (select count(distinct org_id) from public.job_proof_questions where created_at >= v_cur_from)),
    'current', (select to_jsonb(per) - 'period' from per where period = 'cur'),
    'prior',   (select to_jsonb(per) - 'period' from per where period = 'prev'),
    'feedback', null
  ) into v_ask;

  return jsonb_build_object(
    'generated_at', v_now,
    'weeks', v_weeks,
    'windows', jsonb_build_object(
      'current', jsonb_build_object('from', v_cur_from, 'to', v_now),
      'prior',   jsonb_build_object('from', v_prev_from, 'to', v_cur_from)),
    'north_star', jsonb_build_object('weekly', v_series),
    'uploads', v_uploads,
    'analysis', v_analysis,
    'evidence', v_evidence,
    'ask', v_ask
  );
end;
$$;

revoke all on function public.analytics_product_health(integer) from public, anon, authenticated;
grant execute on function public.analytics_product_health(integer) to service_role;
