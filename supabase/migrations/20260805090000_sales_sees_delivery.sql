-- ---------------------------------------------------------------------------
-- Sales can see the work
-- ---------------------------------------------------------------------------
-- Two subsystems have been running side by side without ever being introduced.
--
--   crm_jobs      what Sales sold. Owner, contract, account, contact.
--   pm_projects   what Operations and Field are actually doing. Phase, drying
--                 readings, equipment on site, milestones, customer updates.
--
-- The two live in different migration directories against the same database:
-- pm_projects in supabase/migrations, the CRM in backend/supabase/migrations.
-- This one sits with the CRM because that is where the newest schema lives,
-- and it must be applied after both.
--
-- pm_projects was written on a separate branch and deliberately avoided foreign
-- keys back to the Sales tables so it could apply on its own. That was right at
-- the time and is now the reason a salesperson cannot answer "how is the job
-- going" — the two halves of the same job have no way to find each other.
--
-- This adds the link, in the order a link should be tried:
--
--   1. crm_job_id, when something set it. Explicit and exact.
--   2. claim_number, when both sides have one. This is the identifier the
--      office and the carrier already share, and it is what people match on by
--      hand today.
--
-- Nothing infers a link from a customer name. "Smith" is not an identifier, and
-- a wrong join here would show one customer the progress on another's house.

-- ---------------------------------------------------------------------------
-- 1. The explicit link
-- ---------------------------------------------------------------------------

alter table public.pm_projects
  add column if not exists crm_job_id uuid;

comment on column public.pm_projects.crm_job_id is
  'The crm_jobs row this project delivers, when the two have been linked. '
  'Deliberately not a foreign key, matching source_lead_id: a dangling id is a '
  'smaller problem than a migration that cannot run.';

create index if not exists pm_projects_crm_job_idx
  on public.pm_projects (org_id, crm_job_id)
  where crm_job_id is not null;

-- Claim numbers are how the two sides are matched when nobody has set the link,
-- so the lookup has to be indexed on both.
create index if not exists pm_projects_claim_idx
  on public.pm_projects (org_id, claim_number)
  where claim_number is not null;

create index if not exists crm_jobs_claim_idx
  on public.crm_jobs (org_id, claim_number)
  where claim_number is not null;

-- ---------------------------------------------------------------------------
-- 2. One resolved view of the pairing
-- ---------------------------------------------------------------------------
-- A view rather than a column on either table, because the claim-number match
-- is derived and caching it would go stale the moment a claim number is
-- corrected. `matched_by` travels with the row on purpose: "linked" and "same
-- claim number" are different levels of confidence and anything acting on the
-- pairing should be able to tell them apart.

create or replace view public.crm_job_delivery
with (security_invoker = true) as
select
  j.id            as job_id,
  j.org_id        as org_id,
  p.id            as project_id,
  p.project_number,
  p.phase,
  p.status        as project_status,
  p.pm_user_id,
  p.customer_email,
  p.customer_phone,
  p.adjuster_email,
  p.scheduled_start_at,
  p.target_completion_at,
  p.started_at,
  p.completed_at,
  case when p.crm_job_id is not null then 'linked' else 'claim-number' end as matched_by
from public.crm_jobs j
join public.pm_projects p
  on p.org_id = j.org_id
 and (
   p.crm_job_id = j.id
   or (
     p.crm_job_id is null
     and j.claim_number is not null
     and p.claim_number is not null
     and btrim(upper(j.claim_number)) = btrim(upper(p.claim_number))
   )
 );

comment on view public.crm_job_delivery is
  'The sold job paired with the project delivering it. matched_by says whether '
  'the pairing is explicit or inferred from a shared claim number.';

-- ---------------------------------------------------------------------------
-- 3. One table for every message this platform sends
-- ---------------------------------------------------------------------------
-- crm_sends was built for campaigns and required a campaign_id. A customer
-- update about a job is not a campaign, but it is unquestionably a message the
-- platform sent to somebody — and "who are we reaching out to?" is a question
-- with one answer, not two.
--
-- Widening the existing table rather than adding a second one is what keeps the
-- send guards honest. They read crm_sends for suppressions, hard bounces, prior
-- sends and daily caps; a parallel table would mean a customer who bounced on a
-- campaign still receives job mail, and neither table would know the real
-- volume going out under the org's domain.

alter table public.crm_sends
  alter column campaign_id drop not null;

alter table public.crm_sends
  add column if not exists job_id uuid references public.crm_jobs (id) on delete set null;

alter table public.crm_sends
  add column if not exists kind text not null default 'campaign';

do $$ begin
  alter table public.crm_sends
    add constraint crm_sends_kind_known
    check (kind in ('campaign', 'job_update'));
exception when duplicate_object then null; end $$;

-- Exactly one thing a message can be about. A row with neither is untraceable;
-- a row with both is two claims about the same message.
do $$ begin
  alter table public.crm_sends
    add constraint crm_sends_has_one_subject
    check (
      (kind = 'campaign'   and campaign_id is not null and job_id is null)
      or
      (kind = 'job_update' and job_id is not null and campaign_id is null)
    );
exception when duplicate_object then null; end $$;

create index if not exists crm_sends_job_idx
  on public.crm_sends (org_id, job_id, created_at desc)
  where job_id is not null;

-- The Overview's communications panel groups by person, newest first.
create index if not exists crm_sends_person_idx
  on public.crm_sends (org_id, email, created_at desc);

comment on column public.crm_sends.kind is
  'campaign = outreach to a prospect. job_update = a message about work in '
  'progress, to somebody who is already a customer.';

-- ---------------------------------------------------------------------------
-- 4. Who we are reaching out to
-- ---------------------------------------------------------------------------
-- One row per person, whatever the platform has ever sent them and whether they
-- have since asked it to stop. Built as a view because it is a question about
-- existing rows, and a summary table would be one more thing that can disagree
-- with the record it summarises.

create or replace view public.crm_outreach_people
with (security_invoker = true) as
select
  s.org_id,
  lower(s.email)                                   as email,
  count(*)                                          as messages,
  count(*) filter (where s.state = 'sent')          as delivered,
  count(*) filter (where s.state = 'bounced')       as bounced,
  count(*) filter (where s.state = 'blocked')       as blocked,
  count(*) filter (where s.kind = 'campaign')       as campaign_messages,
  count(*) filter (where s.kind = 'job_update')     as update_messages,
  max(s.created_at)                                 as last_at,
  -- Whether this address can still be written to at all. Reading it here means
  -- the panel can say "unsubscribed — call instead" rather than showing a send
  -- button that will be refused.
  exists (
    select 1 from public.crm_unsubscribes u
    where u.org_id = s.org_id and lower(u.email) = lower(s.email)
  )                                                 as unsubscribed,
  exists (
    select 1 from public.crm_suppressions p
    where p.org_id = s.org_id
      and (
        (p.kind = 'email' and lower(p.value) = lower(s.email))
        or (p.kind = 'domain' and lower(p.value) = split_part(lower(s.email), '@', 2))
      )
  )                                                 as suppressed
from public.crm_sends s
group by s.org_id, lower(s.email);

comment on view public.crm_outreach_people is
  'Every address this platform has sent to, with how it went and whether they '
  'have since opted out. Backs the Overview communications panel.';
