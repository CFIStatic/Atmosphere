-- ============================================================================
-- Sales Agent — natural-language people search history
-- ============================================================================
-- Stores on-demand "find me the director of facilities at …" lookups so reps
-- can revisit sourced answers. Results are org-scoped and RLS-protected.
-- ============================================================================

create table if not exists public.sales_people_searches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  query text not null check (char_length(query) between 2 and 1000),
  parsed jsonb not null default '{}'::jsonb,
  status text not null default 'completed'
    check (status in ('running', 'completed', 'partial', 'failed')),
  summary text check (summary is null or char_length(summary) <= 4000),
  best_match jsonb,
  candidates jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  trace jsonb not null default '[]'::jsonb,
  pages_crawled int not null default 0 check (pages_crawled >= 0),
  searches_run int not null default 0 check (searches_run >= 0),
  duration_ms int check (duration_ms is null or duration_ms >= 0),
  error text check (error is null or char_length(error) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists sales_people_searches_org_created_idx
  on public.sales_people_searches (org_id, created_at desc);

alter table public.sales_people_searches enable row level security;

drop policy if exists sales_people_searches_select on public.sales_people_searches;
create policy sales_people_searches_select on public.sales_people_searches
  for select to authenticated
  using (private.is_org_member(org_id));

drop policy if exists sales_people_searches_insert on public.sales_people_searches;
create policy sales_people_searches_insert on public.sales_people_searches
  for insert to authenticated
  with check (private.can_sell(org_id));

drop policy if exists sales_people_searches_update on public.sales_people_searches;
create policy sales_people_searches_update on public.sales_people_searches
  for update to authenticated
  using (private.can_sell(org_id))
  with check (private.can_sell(org_id));

drop policy if exists sales_people_searches_delete on public.sales_people_searches;
create policy sales_people_searches_delete on public.sales_people_searches
  for delete to authenticated
  using (private.can_sell(org_id));

grant select, insert, update, delete on public.sales_people_searches to authenticated;
revoke all on public.sales_people_searches from anon;
