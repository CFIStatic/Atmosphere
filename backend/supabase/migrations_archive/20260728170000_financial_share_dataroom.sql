-- ============================================================================
-- Financial Agent — third-party shares & dataroom
-- ============================================================================
-- Lets a restoration/construction company package a bank-ready financial
-- report, company narrative, and supporting documents, then hand a
-- time-limited link to a lender, insurer, auditor, or investor.
--
-- The raw share token never lands in Postgres — only its SHA-256 hash — so a
-- database dump cannot open an active dataroom.
-- ============================================================================

create schema if not exists private;

-- ----------------------------------------------------------------------------
-- 1. Share packages (frozen report + company story)
-- ----------------------------------------------------------------------------

create table if not exists public.finance_share_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.finance_current_org()
    references public.orgs(id) on delete cascade,

  title text not null check (length(btrim(title)) between 2 and 160),
  purpose text not null default 'loan'
    check (purpose in ('loan', 'insurance', 'investor', 'auditor', 'partner', 'other')),

  recipient_name text check (recipient_name is null or length(btrim(recipient_name)) between 1 and 160),
  recipient_org text check (recipient_org is null or length(btrim(recipient_org)) between 1 and 160),
  recipient_email text check (
    recipient_email is null
    or recipient_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  cover_note text check (cover_note is null or length(cover_note) <= 8000),

  status text not null default 'draft'
    check (status in ('draft', 'active', 'revoked', 'expired')),

  -- Which sections the package includes (frozen at publish for the viewer).
  sections jsonb not null default '{
    "executiveSummary": true,
    "companyOverview": true,
    "teamAndRoles": true,
    "howWeWork": true,
    "cashPosition": true,
    "accountsReceivable": true,
    "jobCosting": true,
    "backlog": true,
    "alerts": true,
    "documents": true
  }'::jsonb,

  -- Frozen payloads so a later books change does not rewrite what the bank saw.
  report jsonb not null default '{}'::jsonb,
  company_profile jsonb not null default '{}'::jsonb,

  published_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),

  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.finance_share_packages is
  'Third-party financial dataroom packages (loan / insurance / investor). Report is frozen at publish.';

create index if not exists finance_share_packages_org_idx
  on public.finance_share_packages (org_id, status, created_at desc);

drop trigger if exists finance_share_packages_touch on public.finance_share_packages;
create trigger finance_share_packages_touch
  before update on public.finance_share_packages
  for each row execute function private.touch_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Documents in the dataroom
-- ----------------------------------------------------------------------------

create table if not exists public.finance_share_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.finance_current_org()
    references public.orgs(id) on delete cascade,
  package_id uuid not null references public.finance_share_packages(id) on delete cascade,

  title text not null check (length(btrim(title)) between 1 and 200),
  kind text not null check (kind in (
    'articles_of_incorporation',
    'operating_agreement',
    'ein_letter',
    'business_license',
    'contractor_license',
    'insurance_coi',
    'tax_return',
    'financial_statement',
    'bank_statement',
    'ar_aging',
    'job_cost_summary',
    'org_chart',
    'resume_key_person',
    'other'
  )),
  description text check (description is null or length(description) <= 2000),
  -- Where the artifact lives (URL or storage path). Blobs are a separate design.
  external_ref text check (external_ref is null or length(external_ref) <= 2000),
  period_label text check (period_label is null or length(period_label) <= 80),
  sort_order integer not null default 0,

  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.finance_share_documents is
  'Supporting documents attached to a financial share package. Metadata + external_ref only.';

create index if not exists finance_share_documents_package_idx
  on public.finance_share_documents (package_id, sort_order, created_at);

-- ----------------------------------------------------------------------------
-- 3. Time-limited share links (token hash only)
-- ----------------------------------------------------------------------------

create table if not exists public.finance_share_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default private.finance_current_org()
    references public.orgs(id) on delete cascade,
  package_id uuid not null references public.finance_share_packages(id) on delete cascade,

  -- SHA-256 hex of the raw token. Raw token is shown once to the creator.
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  token_prefix text not null check (length(token_prefix) between 6 and 16),

  label text check (label is null or length(btrim(label)) between 1 and 120),
  expires_at timestamptz not null,
  max_views integer check (max_views is null or max_views between 1 and 100000),
  view_count integer not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz,

  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),

  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.finance_share_links is
  'Time-limited third-party access to a finance share package. Stores token hash only.';

create index if not exists finance_share_links_package_idx
  on public.finance_share_links (package_id, created_at desc);

create index if not exists finance_share_links_hash_idx
  on public.finance_share_links (token_hash)
  where revoked_at is null;

-- ----------------------------------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------------------------------

alter table public.finance_share_packages enable row level security;
alter table public.finance_share_documents enable row level security;
alter table public.finance_share_links enable row level security;

-- Packages: members can read; only finance managers write.
drop policy if exists finance_share_packages_select on public.finance_share_packages;
create policy finance_share_packages_select on public.finance_share_packages
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_share_packages_insert on public.finance_share_packages;
create policy finance_share_packages_insert on public.finance_share_packages
  for insert to authenticated
  with check (private.can_manage_finance(org_id));

drop policy if exists finance_share_packages_update on public.finance_share_packages;
create policy finance_share_packages_update on public.finance_share_packages
  for update to authenticated
  using (private.can_manage_finance(org_id))
  with check (private.can_manage_finance(org_id));

-- Documents
drop policy if exists finance_share_documents_select on public.finance_share_documents;
create policy finance_share_documents_select on public.finance_share_documents
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_share_documents_insert on public.finance_share_documents;
create policy finance_share_documents_insert on public.finance_share_documents
  for insert to authenticated
  with check (private.can_manage_finance(org_id));

drop policy if exists finance_share_documents_update on public.finance_share_documents;
create policy finance_share_documents_update on public.finance_share_documents
  for update to authenticated
  using (private.can_manage_finance(org_id))
  with check (private.can_manage_finance(org_id));

drop policy if exists finance_share_documents_delete on public.finance_share_documents;
create policy finance_share_documents_delete on public.finance_share_documents
  for delete to authenticated
  using (private.can_manage_finance(org_id));

-- Links: members read metadata; managers mint/revoke. Raw tokens never returned from SELECT.
drop policy if exists finance_share_links_select on public.finance_share_links;
create policy finance_share_links_select on public.finance_share_links
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists finance_share_links_insert on public.finance_share_links;
create policy finance_share_links_insert on public.finance_share_links
  for insert to authenticated
  with check (private.can_manage_finance(org_id));

drop policy if exists finance_share_links_update on public.finance_share_links;
create policy finance_share_links_update on public.finance_share_links
  for update to authenticated
  using (private.can_manage_finance(org_id))
  with check (private.can_manage_finance(org_id));

-- ----------------------------------------------------------------------------
-- 5. Public open RPC (anon / unauthenticated third parties)
-- ----------------------------------------------------------------------------
-- Third-party viewers have no JWT. They present the raw token; we hash it and
-- return the frozen package if the link is still valid. View counting happens
-- in the same call so each open is attributable.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.open_finance_share(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_hash text;
  v_link public.finance_share_links%rowtype;
  v_pkg public.finance_share_packages%rowtype;
  v_docs jsonb;
  v_org_name text;
begin
  if p_token is null or length(p_token) < 20 or length(p_token) > 200 then
    raise exception 'invalid share token' using errcode = '22023';
  end if;

  v_hash := encode(digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  select * into v_link
  from public.finance_share_links
  where token_hash = v_hash
  limit 1;

  if not found then
    raise exception 'share not found' using errcode = 'P0002';
  end if;

  if v_link.revoked_at is not null then
    raise exception 'share revoked' using errcode = 'P0001';
  end if;

  if v_link.expires_at <= now() then
    raise exception 'share expired' using errcode = 'P0001';
  end if;

  if v_link.max_views is not null and v_link.view_count >= v_link.max_views then
    raise exception 'share view limit reached' using errcode = 'P0001';
  end if;

  select * into v_pkg
  from public.finance_share_packages
  where id = v_link.package_id;

  if not found or v_pkg.status <> 'active' then
    raise exception 'share is not published' using errcode = 'P0001';
  end if;

  update public.finance_share_links
     set view_count = view_count + 1,
         last_viewed_at = now()
   where id = v_link.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'title', d.title,
        'kind', d.kind,
        'description', d.description,
        'externalRef', d.external_ref,
        'periodLabel', d.period_label,
        'sortOrder', d.sort_order
      )
      order by d.sort_order, d.created_at
    ),
    '[]'::jsonb
  )
  into v_docs
  from public.finance_share_documents d
  where d.package_id = v_pkg.id;

  select o.name into v_org_name from public.orgs o where o.id = v_pkg.org_id;

  return jsonb_build_object(
    'packageId', v_pkg.id,
    'title', v_pkg.title,
    'purpose', v_pkg.purpose,
    'recipientName', v_pkg.recipient_name,
    'recipientOrg', v_pkg.recipient_org,
    'coverNote', v_pkg.cover_note,
    'sections', v_pkg.sections,
    'report', v_pkg.report,
    'companyProfile', v_pkg.company_profile,
    'documents', v_docs,
    'orgName', v_org_name,
    'publishedAt', v_pkg.published_at,
    'expiresAt', v_link.expires_at,
    'viewCount', v_link.view_count + 1
  );
end;
$$;

revoke all on function public.open_finance_share(text) from public;
grant execute on function public.open_finance_share(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Grants
-- ----------------------------------------------------------------------------

grant select, insert, update on public.finance_share_packages to authenticated;
grant select, insert, update, delete on public.finance_share_documents to authenticated;
grant select, insert, update on public.finance_share_links to authenticated;
