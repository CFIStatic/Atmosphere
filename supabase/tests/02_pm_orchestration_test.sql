-- ============================================================================
-- PM orchestration — schema guarantees
-- ============================================================================
-- Run after 01_project_manager_test.sql fixtures (same org / users), or alone
-- after seeding the minimal org rows below. Applied by supabase/tests/run.sh
-- when listed; safe to run against a throwaway database only.

\set ON_ERROR_STOP off
\pset pager off

\echo '\n=== Orchestration 0. Seed (idempotent with 01 fixtures) ==='
insert into auth.users (id, email) values
  ('0a000000-0000-4000-8000-000000000001', 'pm@acme.test')
on conflict (id) do nothing;

insert into public.orgs (id, name, join_code, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'Acme Restoration', 'ACME01',
   '0a000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into public.org_members (org_id, user_id, role, work_type) values
  ('11111111-1111-1111-1111-111111111111', '0a000000-0000-4000-8000-000000000001',
   'project_manager', 'mitigation')
on conflict do nothing;

insert into public.pm_projects (id, org_id, name, work_type, loss_type, pm_user_id)
values ('0c000000-0000-4000-8000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'Water loss — 14 Elm St', 'mitigation', 'water',
        '0a000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

\echo '\n=== Orchestration 1. Manager can connect a platform ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';

  insert into public.pm_platform_connections (org_id, platform, status)
  values ('11111111-1111-1111-1111-111111111111', 'dash', 'connected');

  insert into public.pm_platform_links (project_id, platform, external_id, external_label)
  values ('0c000000-0000-4000-8000-000000000001', 'dash', 'dash-job-99', 'Elm St');

  insert into public.pm_communications
    (org_id, project_id, channel, body, fingerprint, counterparty_kind, status)
  values ('11111111-1111-1111-1111-111111111111',
          '0c000000-0000-4000-8000-000000000001',
          'whatsapp',
          '@atmosphere dumpster arrives tomorrow at 8',
          'test:whatsapp:1', 'vendor', 'new');

  insert into public.pm_approvals (org_id, project_id, kind, title, proposed_action, platform)
  values ('11111111-1111-1111-1111-111111111111',
          '0c000000-0000-4000-8000-000000000001',
          'accept_procurement_bid', 'Accept WM dumpster bid',
          '{"type":"accept_bid"}'::jsonb, 'web');

  insert into public.pm_equipment_plans (project_id, source, dumpster_required, summary)
  values ('0c000000-0000-4000-8000-000000000001', 'mitigation_estimate', true, 'test plan');

  \echo '--- expect: connection, link, communication, approval, plan'
  select
    (select count(*) from public.pm_platform_connections where org_id = '11111111-1111-1111-1111-111111111111') as connections,
    (select count(*) from public.pm_platform_links where project_id = '0c000000-0000-4000-8000-000000000001') as links,
    (select count(*) from public.pm_communications where fingerprint = 'test:whatsapp:1') as comms,
    (select count(*) from public.pm_approvals where status = 'pending') as approvals,
    (select count(*) from public.pm_equipment_plans where dumpster_required) as plans;
commit;

\echo '\n=== Orchestration 2. Referral catalogue is readable ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  \echo '--- expect: at least homedepot and lowes'
  select vendor_key, name, commission_bps
  from public.pm_vendor_referrals
  where org_id is null and active
  order by vendor_key;
commit;

\echo '\n=== Orchestration 3. Platform events are insert-only (expect ERROR on update) ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';

  insert into public.pm_platform_events (org_id, project_id, platform, event_kind, summary)
  values ('11111111-1111-1111-1111-111111111111',
          '0c000000-0000-4000-8000-000000000001',
          'xactimate', 'synced', 'Pulled estimate revision')
  returning id \gset

  update public.pm_platform_events set summary = 'rewritten' where id = :'id';
rollback;

\echo '\n=== Orchestration 4. Nothing can be deleted (expect ERROR) ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  delete from public.pm_approvals;
rollback;

\echo '\n=== Orchestration 5. Alert category accepts orchestration ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  insert into public.pm_alerts
    (org_id, project_id, rule_key, fingerprint, severity, category, title)
  values ('11111111-1111-1111-1111-111111111111',
          '0c000000-0000-4000-8000-000000000001',
          'approval_pending', 'approval_pending:test', 'warn', 'orchestration',
          'Needs your OK — test');
  \echo '--- expect: 1 orchestration alert'
  select category, title from public.pm_alerts where fingerprint = 'approval_pending:test';
commit;
