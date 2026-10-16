-- ============================================================================
-- CRM connections — self-serve credentials + push ledger
-- ============================================================================
-- Extends the external mirror so a member can connect Dash, Luxor, Salesforce,
-- or any REST CRM from the UI without an operator editing server env vars.
--
-- Secrets are sealed with AES-256-GCM before they reach this table. The
-- encryption key lives only in INTEGRATIONS_CREDENTIAL_KEY (env). A dump of
-- these columns yields ciphertext, not a working login — the same separation
-- the estimator and Web Access vaults use.
--
-- credential_ref (env-based) still works and takes precedence when no sealed
-- secret is present, so existing operator-managed sources keep behaving.
--
-- Safe to re-run.
-- ============================================================================

alter table public.crm_external_sources
  add column if not exists credential_ciphertext text,
  add column if not exists credential_iv text,
  add column if not exists credential_auth_tag text,
  add column if not exists credential_fingerprint text,
  -- Last time mirrored records were promoted into the native CRM.
  add column if not exists last_promote_at timestamptz;

-- Capabilities declared at connect time (pull / push / both). Informational;
-- the connectors enforce what they actually support.
alter table public.crm_external_sources
  add column if not exists direction text not null default 'bidirectional'
    check (direction in ('pull', 'push', 'bidirectional'));

-- ---------------------------------------------------------------------------
-- Push ledger — every write we sent to an external CRM
-- ---------------------------------------------------------------------------
-- Separate from the mirror: the mirror is what *they* said; this is what *we*
-- asked them to accept. Kept so support can answer "did Atmosphere write that
-- note into Salesforce?" without reading vendor logs.

create table if not exists public.crm_push_runs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs (id) on delete cascade,
  source_id       uuid not null references public.crm_external_sources (id) on delete cascade,
  status          text not null default 'running'
                    check (status in ('running', 'succeeded', 'failed', 'partial')),
  operation       text not null check (length(btrim(operation)) between 1 and 80),
  entity_type     text,
  external_id     text,
  request_summary jsonb,
  response_summary jsonb,
  error           text,
  started_by      uuid references public.profiles (id) on delete set null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists crm_push_runs_org_idx
  on public.crm_push_runs (org_id, started_at desc);

create index if not exists crm_push_runs_source_idx
  on public.crm_push_runs (source_id, started_at desc);

alter table public.crm_push_runs enable row level security;

drop policy if exists crm_push_runs_select on public.crm_push_runs;
create policy crm_push_runs_select on public.crm_push_runs
  for select to authenticated
  using (private.is_org_member(org_id));

-- Members may read push history; only the service role (connectors) writes it.
revoke all on public.crm_push_runs from anon, authenticated;
grant select on public.crm_push_runs to authenticated;
