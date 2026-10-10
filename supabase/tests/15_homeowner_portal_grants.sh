#!/usr/bin/env bash
#
# Homeowner portal RLS (20261010210000_homeowner_portal_grants), on a database
# that has every migration applied (`npm run migrate:manifest`), in a
# rolled-back transaction:
#
#   - an invited homeowner reads the jobs (and live clips) shared with their
#     email, across two contractor orgs, and nothing else from either org
#   - a grant whose invite is revoked, or addressed to another email, opens nothing
#   - revoking the invite stamps the grant revoked
#   - invited viewers cannot write jobs
#
# Usage:  PORTAL_TEST_DB=atmosphere_migration_manifest \
#           supabase/tests/15_homeowner_portal_grants.sh [psql-connection-args...]
#
set -euo pipefail

DB="${PORTAL_TEST_DB:-atmosphere_migration_manifest}"
PSQL=(psql "$@" -q -X -v ON_ERROR_STOP=1 -d "$DB")

"${PSQL[@]}" <<'SQL'
\set QUIET on
\o /dev/null
begin;

create or replace function pg_temp.expect(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'ok: %', label;
end $$;

-- Supabase grants table privileges to authenticated; RLS decides the rows.
grant select, update on public.crm_jobs, public.job_proofs to authenticated;

insert into auth.users (id, email) values
  ('0e000000-0000-4000-8000-000000001501', 'home15@test.invalid'),
  ('0e000000-0000-4000-8000-000000001502', 'other15@test.invalid')
on conflict (id) do nothing;
insert into public.profiles (id, email) values
  ('0e000000-0000-4000-8000-000000001501', 'home15@test.invalid'),
  ('0e000000-0000-4000-8000-000000001502', 'other15@test.invalid')
on conflict (id) do nothing;
insert into public.orgs (id, name, join_code) values
  ('a0000000-0000-4000-8000-000000001501', 'TEST Roofing 15', 'TEST-A-15'),
  ('a0000000-0000-4000-8000-000000001502', 'TEST Restoration 15', 'TEST-B-15');

insert into public.crm_jobs (id, org_id, work_type, title) values
  ('c0000000-0000-4000-8000-000000001501', 'a0000000-0000-4000-8000-000000001501', 'mitigation', 'Roof'),
  ('c0000000-0000-4000-8000-000000001502', 'a0000000-0000-4000-8000-000000001502', 'mitigation', 'Kitchen'),
  ('c0000000-0000-4000-8000-000000001503', 'a0000000-0000-4000-8000-000000001501', 'mitigation', 'Neighbor (not shared)'),
  ('c0000000-0000-4000-8000-000000001504', 'a0000000-0000-4000-8000-000000001502', 'mitigation', 'Revoked later'),
  ('c0000000-0000-4000-8000-000000001505', 'a0000000-0000-4000-8000-000000001502', 'mitigation', 'Readdressed');

insert into public.verifier_shares (id, org_id, job_id, label, share_kind, recipient_email) values
  ('e0000000-0000-4000-8000-000000001501', 'a0000000-0000-4000-8000-000000001501', 'c0000000-0000-4000-8000-000000001501', 'Homeowner', 'progress', 'home15@test.invalid'),
  ('e0000000-0000-4000-8000-000000001502', 'a0000000-0000-4000-8000-000000001502', 'c0000000-0000-4000-8000-000000001502', 'Homeowner', 'progress', 'HOME15@test.invalid'),
  ('e0000000-0000-4000-8000-000000001504', 'a0000000-0000-4000-8000-000000001502', 'c0000000-0000-4000-8000-000000001504', 'Homeowner', 'progress', 'home15@test.invalid'),
  ('e0000000-0000-4000-8000-000000001505', 'a0000000-0000-4000-8000-000000001502', 'c0000000-0000-4000-8000-000000001505', 'Homeowner', 'progress', 'someone-else@test.invalid');

insert into public.job_progress_grants (org_id, job_id, user_id, share_id, recipient_email) values
  ('a0000000-0000-4000-8000-000000001501', 'c0000000-0000-4000-8000-000000001501', '0e000000-0000-4000-8000-000000001501', 'e0000000-0000-4000-8000-000000001501', 'home15@test.invalid'),
  ('a0000000-0000-4000-8000-000000001502', 'c0000000-0000-4000-8000-000000001502', '0e000000-0000-4000-8000-000000001501', 'e0000000-0000-4000-8000-000000001502', 'home15@test.invalid'),
  ('a0000000-0000-4000-8000-000000001502', 'c0000000-0000-4000-8000-000000001504', '0e000000-0000-4000-8000-000000001501', 'e0000000-0000-4000-8000-000000001504', 'home15@test.invalid'),
  ('a0000000-0000-4000-8000-000000001502', 'c0000000-0000-4000-8000-000000001505', '0e000000-0000-4000-8000-000000001501', 'e0000000-0000-4000-8000-000000001505', 'home15@test.invalid');

insert into public.job_parties (id, org_id, job_id, company, role) values
  ('d1000000-0000-4000-8000-000000001501', 'a0000000-0000-4000-8000-000000001501', 'c0000000-0000-4000-8000-000000001501', 'Crew', 'subcontractor'),
  ('d1000000-0000-4000-8000-000000001503', 'a0000000-0000-4000-8000-000000001501', 'c0000000-0000-4000-8000-000000001503', 'Crew', 'subcontractor');

insert into public.job_proofs (id, org_id, job_id, party_id, work_date, phase, storage_path) values
  ('d3000000-0000-4000-8000-000000001501', 'a0000000-0000-4000-8000-000000001501', 'c0000000-0000-4000-8000-000000001501', 'd1000000-0000-4000-8000-000000001501', '2026-10-01', 'before', 'o/j/a.mp4'),
  ('d3000000-0000-4000-8000-000000001503', 'a0000000-0000-4000-8000-000000001501', 'c0000000-0000-4000-8000-000000001503', 'd1000000-0000-4000-8000-000000001503', '2026-10-01', 'before', 'o/j/b.mp4');
insert into public.job_proofs (id, org_id, job_id, party_id, work_date, phase, storage_path, deleted_at) values
  ('d3000000-0000-4000-8000-000000001502', 'a0000000-0000-4000-8000-000000001501', 'c0000000-0000-4000-8000-000000001501', 'd1000000-0000-4000-8000-000000001501', '2026-10-01', 'after', 'o/j/c.mp4', now());

-- Contractor revokes one invite.
update public.verifier_shares set revoked_at = now() where id = 'e0000000-0000-4000-8000-000000001504';
select pg_temp.expect((select revoked_at is not null from public.job_progress_grants
  where share_id = 'e0000000-0000-4000-8000-000000001504'), 'revoking the invite revokes the grant');

-- As the homeowner.
select set_config('request.jwt.claim.sub', '0e000000-0000-4000-8000-000000001501', true);
set local role authenticated;
select pg_temp.expect((select array_agg(title order by title) from public.crm_jobs where title in
  ('Roof','Kitchen','Neighbor (not shared)','Revoked later','Readdressed')) = array['Kitchen','Roof'],
  'homeowner sees exactly the two live invited jobs, across two orgs');
select pg_temp.expect((select count(*) from public.job_proofs where job_id in
  ('c0000000-0000-4000-8000-000000001501','c0000000-0000-4000-8000-000000001503')) = 1,
  'homeowner sees live clips on invited jobs only (no deleted, no other job)');
update public.crm_jobs set title = 'Hacked' where id = 'c0000000-0000-4000-8000-000000001501';
reset role;
select pg_temp.expect((select title = 'Roof' from public.crm_jobs where id = 'c0000000-0000-4000-8000-000000001501'),
  'invited viewer cannot edit the job');

-- As someone else with no grant.
select set_config('request.jwt.claim.sub', '0e000000-0000-4000-8000-000000001502', true);
set local role authenticated;
select pg_temp.expect((select count(*) from public.crm_jobs where title in ('Roof','Kitchen')) = 0,
  'another account sees none of them');
reset role;

rollback;
SQL
echo "homeowner portal grants: all checks passed"
