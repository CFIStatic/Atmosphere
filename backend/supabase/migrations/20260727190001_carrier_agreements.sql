-- ============================================================================
-- Carrier program agreements and documented deviations
--
-- Apply after 0001_mitigation_estimator.sql.
--
-- A program agreement decides what a franchise may bill and what it will be
-- charged back for. Two consequences shape this schema:
--
--   * Agreements are ORG-scoped, not user-scoped. A franchise signs one set of
--     terms per carrier program and every estimator in the office works to it.
--     Per-user copies would produce estimates from the same office that disagree
--     about what the carrier pays.
--
--   * Deviations are JOB-scoped and carry who accepted them. Exceeding a
--     carrier's terms is a decision someone made about one loss, and the record
--     has to say who, when, why, and on what evidence.
-- ============================================================================

create table if not exists public.carrier_agreements (
  org_id         uuid not null references public.orgs (id) on delete cascade,
  carrier_id     text not null,
  program_id     text not null,
  carrier_name   text not null,
  program_name   text not null,
  version        text not null default 'unversioned',
  effective_from date,
  effective_to   date,
  -- The machine-checkable terms. Stored whole rather than shredded into columns:
  -- constraint kinds are a growing union, and a schema migration per new term
  -- would be a poor trade for a document that is read whole every time.
  rules          jsonb not null default '[]'::jsonb,
  -- Provenance: where the terms came from, when, and who entered them. An audit
  -- of a disputed estimate starts here.
  source         jsonb not null default '{}'::jsonb,
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (org_id, carrier_id, program_id)
);

create index if not exists carrier_agreements_org_carrier_idx
  on public.carrier_agreements (org_id, carrier_id);

alter table public.carrier_agreements enable row level security;

drop policy if exists carrier_agreements_select on public.carrier_agreements;
create policy carrier_agreements_select on public.carrier_agreements
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists carrier_agreements_write on public.carrier_agreements;
create policy carrier_agreements_write on public.carrier_agreements
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Deviations
--
-- The database enforces what the application enforces: a deviation without a
-- reason, or without evidence behind it, is not a deviation. Putting the check
-- here as well means a future code path cannot quietly write an undocumented
-- one, which is the whole difference between a considered exception and a habit
-- of writing "per carrier" next to every overage.
-- ---------------------------------------------------------------------------

create table if not exists public.carrier_deviations (
  org_id          uuid not null references public.orgs (id) on delete cascade,
  -- The agent's own job identifier, so a deviation survives an estimate rebuild.
  external_job_id text not null,
  rule_id         text not null,
  reason          text not null,
  evidence_ids    text[] not null default '{}',
  -- The named person who authorised exceeding the term. A role is not a person.
  authorized_by   text,
  authorized_at   timestamptz not null default now(),
  accepted_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (org_id, external_job_id, rule_id),
  constraint carrier_deviation_has_reason check (length(btrim(reason)) > 0),
  constraint carrier_deviation_has_evidence check (array_length(evidence_ids, 1) >= 1)
);

create index if not exists carrier_deviations_job_idx
  on public.carrier_deviations (org_id, external_job_id);

alter table public.carrier_deviations enable row level security;

drop policy if exists carrier_deviations_select on public.carrier_deviations;
create policy carrier_deviations_select on public.carrier_deviations
  for select to authenticated using (private.is_org_member(org_id));

drop policy if exists carrier_deviations_write on public.carrier_deviations;
create policy carrier_deviations_write on public.carrier_deviations
  for all to authenticated
  using (private.is_org_member(org_id)) with check (private.is_org_member(org_id));

revoke all on public.carrier_agreements, public.carrier_deviations from anon;
