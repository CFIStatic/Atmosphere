-- ---------------------------------------------------------------------------
-- Symbility (CoreLogic Claims Connect) connections
-- ---------------------------------------------------------------------------
-- The second estimating platform, alongside Xactimate — many carrier programs
-- mandate one or the other, and a restoration org routinely holds both. The
-- table mirrors xactimate_connections deliberately, constraint for
-- constraint: the shape earned its rules there and the rules are about
-- credentials generally, not about Verisk.
--
--   * `sealed_credential` holds an AES-256-GCM envelope whose key lives only
--     in the server's environment (SYMBILITY_ENC_KEY, falling back to the
--     shared estimator vault key). NULL for session-only connections, which
--     is the default and the recommended mode.
--   * Policies are scoped to the user, not the org: an org's members share
--     estimates, but nobody sees anyone else's login grant.

create table if not exists public.symbility_connections (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  org_id              uuid references public.orgs (id) on delete set null,
  consent_id          uuid not null,
  symbility_username  text not null,
  scopes              text[] not null default '{}',
  storage_mode        text not null default 'session'
                        check (storage_mode in ('session', 'stored')),
  granted_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  granted_ip          text,
  granted_user_agent  text,
  sealed_credential   jsonb,
  -- A revoked grant must never keep a credential, whatever a future code path
  -- forgets to null out.
  constraint symbility_revoked_has_no_credential
    check (revoked_at is null or sealed_credential is null),
  -- A session-only connection has nothing to store, by definition.
  constraint symbility_session_mode_stores_nothing
    check (storage_mode = 'stored' or sealed_credential is null)
);

alter table public.symbility_connections enable row level security;

drop policy if exists symbility_connections_own on public.symbility_connections;
create policy symbility_connections_own on public.symbility_connections
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Activity log — insert and select only. An audit trail that can be edited is
-- not an audit trail.
-- ---------------------------------------------------------------------------

create table if not exists public.symbility_audit (
  id         uuid primary key default gen_random_uuid(),
  consent_id uuid not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  scope      text not null,
  action     text not null,
  detail     text not null default '',
  succeeded  boolean not null default true,
  at         timestamptz not null default now()
);

create index if not exists symbility_audit_user_idx
  on public.symbility_audit (user_id, at desc);

alter table public.symbility_audit enable row level security;

drop policy if exists symbility_audit_select on public.symbility_audit;
create policy symbility_audit_select on public.symbility_audit
  for select to authenticated using (user_id = auth.uid());

drop policy if exists symbility_audit_insert on public.symbility_audit;
create policy symbility_audit_insert on public.symbility_audit
  for insert to authenticated with check (user_id = auth.uid());

revoke all on public.symbility_connections, public.symbility_audit from anon;
