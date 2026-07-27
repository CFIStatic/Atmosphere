-- ============================================================================
-- Project Manager Agent — schema guarantees
-- ============================================================================
-- Every section that is expected to fail says so in its heading. An ERROR under
-- one of those headings is the guarantee working; an ERROR anywhere else, or a
-- *missing* ERROR under one of them, is a regression.
--
-- Run with supabase/tests/run.sh — never against a real project. Section 16
-- asserts that data cannot be deleted, so it needs a database it may throw away.

\set ON_ERROR_STOP off
\timing off
\pset pager off

-- ---------------------------------------------------------------------------
-- Fixtures: two organizations that must never see each other.
-- ---------------------------------------------------------------------------
\echo '\n=== 0. Seed ==='

insert into auth.users (id, email) values
  ('0a000000-0000-4000-8000-000000000001', 'pm@acme.test'),
  ('0a000000-0000-4000-8000-000000000002', 'tech@acme.test'),
  ('0a000000-0000-4000-8000-000000000003', 'office@acme.test'),
  ('0b000000-0000-4000-8000-000000000001', 'pm@rival.test');

insert into public.orgs (id, name, join_code, created_by) values
  ('11111111-1111-1111-1111-111111111111', 'Acme Restoration', 'ACME01',
   '0a000000-0000-4000-8000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'Rival Restoration', 'RIVAL1',
   '0b000000-0000-4000-8000-000000000001');

insert into public.org_members (org_id, user_id, role, work_type) values
  ('11111111-1111-1111-1111-111111111111', '0a000000-0000-4000-8000-000000000001',
   'project_manager', 'mitigation'),
  ('11111111-1111-1111-1111-111111111111', '0a000000-0000-4000-8000-000000000002',
   'field_technician', 'mitigation'),
  ('11111111-1111-1111-1111-111111111111', '0a000000-0000-4000-8000-000000000003',
   'office_manager', 'mitigation'),
  ('22222222-2222-2222-2222-222222222222', '0b000000-0000-4000-8000-000000000001',
   'project_manager', 'mitigation');

\echo '--- expect: 4 users, 2 orgs, 4 memberships'
select (select count(*) from auth.users) as users,
       (select count(*) from public.orgs) as orgs,
       (select count(*) from public.org_members) as members;

-- ---------------------------------------------------------------------------
\echo '\n=== 1. A project manager can open a project; the number is assigned ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';

  insert into public.pm_projects (id, org_id, name, work_type, loss_type, pm_user_id, customer_name)
  values ('0c000000-0000-4000-8000-000000000001',
          '11111111-1111-1111-1111-111111111111',
          'Water loss — 14 Elm St', 'mitigation', 'water',
          '0a000000-0000-4000-8000-000000000001', 'J. Okafor');

  insert into public.pm_projects (org_id, name, work_type)
  values ('11111111-1111-1111-1111-111111111111', 'Kitchen rebuild — 9 Oak', 'construction');

  \echo '--- expect: PRJ-0001 and PRJ-0002, seq 1 and 2'
  select project_number, seq_no, phase, status from public.pm_projects order by seq_no;
commit;

-- ---------------------------------------------------------------------------
\echo '\n=== 2. A field technician CANNOT open a project (expect ERROR) ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  insert into public.pm_projects (org_id, name, work_type)
  values ('11111111-1111-1111-1111-111111111111', 'Tech-created job', 'mitigation');
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 3. A technician CAN establish a drying area and log readings ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';

  -- org_id deliberately omitted: the fill trigger derives it from the project.
  insert into public.pm_drying_areas (id, project_id, label, material, dry_goal_pct, water_class, affected_sqft)
  values ('0e000000-0000-4000-8000-000000000001',
          '0c000000-0000-4000-8000-000000000001', 'Kitchen', 'drywall', 16.0, 2, 240);

  insert into public.pm_moisture_readings (project_id, area_id, kind, moisture_pct, temperature_f, humidity_pct, taken_at)
  values ('0c000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
          'affected', 38.5, 78, 55, now() - interval '2 days'),
         ('0c000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
          'affected', 31.0, 79, 48, now() - interval '1 day'),
         ('0c000000-0000-4000-8000-000000000001', '0e000000-0000-4000-8000-000000000001',
          'affected', 24.2, 80, 42, now());

  \echo '--- expect: org_id derived onto all 3 readings, all Acme'
  select count(*) as readings,
         count(distinct org_id) as distinct_orgs,
         (org_id = '11111111-1111-1111-1111-111111111111') as is_acme
  from public.pm_moisture_readings group by org_id;
commit;

-- ---------------------------------------------------------------------------
\echo '\n=== 4. A reading cannot be edited (expect ERROR — append-only log) ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_moisture_readings set moisture_pct = 12.0;
rollback;

\echo '--- and not by the project manager either (expect ERROR)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  update public.pm_moisture_readings set moisture_pct = 12.0;
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 5. A reading with neither moisture nor air condition is refused (expect ERROR) ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  insert into public.pm_moisture_readings (project_id, kind, note)
  values ('0c000000-0000-4000-8000-000000000001', 'affected', 'meter was flat');
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 6. Generated tasks are idempotent by origin_key (expect ERROR on the second) ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';

  insert into public.pm_tasks (project_id, title, source, origin_key, category, assigned_to)
  values ('0c000000-0000-4000-8000-000000000001', 'Take daily moisture readings',
          'playbook', 'drying:daily_readings', 'drying',
          '0a000000-0000-4000-8000-000000000002');
  \echo '--- first insert succeeded; the duplicate below must fail'
  insert into public.pm_tasks (project_id, title, source, origin_key)
  values ('0c000000-0000-4000-8000-000000000001', 'Take daily moisture readings',
          'playbook', 'drying:daily_readings');
rollback;

\echo '--- re-insert the task for later sections (committed this time)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  insert into public.pm_tasks (id, project_id, title, source, origin_key, category, assigned_to)
  values ('0f000000-0000-4000-8000-000000000001',
          '0c000000-0000-4000-8000-000000000001', 'Take daily moisture readings',
          'playbook', 'drying:daily_readings', 'drying',
          '0a000000-0000-4000-8000-000000000002');
commit;

-- ---------------------------------------------------------------------------
\echo '\n=== 7. An assignee may finish their task ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_tasks set status = 'done' where id = '0f000000-0000-4000-8000-000000000001';
  \echo '--- expect: done, completed_at set, completed_by = the technician'
  select status, completed_at is not null as stamped,
         completed_by = '0a000000-0000-4000-8000-000000000002' as by_tech
  from public.pm_tasks where id = '0f000000-0000-4000-8000-000000000001';
rollback;

\echo '\n=== 8. An assignee may NOT reassign or re-scope it (expect 2 ERRORs) ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_tasks set assigned_to = '0a000000-0000-4000-8000-000000000001'
  where id = '0f000000-0000-4000-8000-000000000001';
rollback;
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_tasks set due_at = now() + interval '30 days'
  where id = '0f000000-0000-4000-8000-000000000001';
rollback;

\echo '\n=== 9. Blocking a task without a reason is refused (expect ERROR) ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  update public.pm_tasks set status = 'blocked' where id = '0f000000-0000-4000-8000-000000000001';
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 10. Cross-organization isolation ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0b000000-0000-4000-8000-000000000001';
  \echo '--- expect: 0 projects, 0 readings, 0 tasks visible to the rival PM'
  select (select count(*) from public.pm_projects) as projects,
         (select count(*) from public.pm_moisture_readings) as readings,
         (select count(*) from public.pm_tasks) as tasks;
commit;

\echo '--- the rival PM cannot write into an Acme project even naming their own org (expect ERROR)'
\echo '    (the fill trigger rewrites org_id to Acme, so the check runs against Acme membership)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0b000000-0000-4000-8000-000000000001';
  insert into public.pm_tasks (project_id, org_id, title)
  values ('0c000000-0000-4000-8000-000000000001',
          '22222222-2222-2222-2222-222222222222', 'Smuggled task');
rollback;

\echo '--- nor log a reading into it (expect ERROR)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0b000000-0000-4000-8000-000000000001';
  insert into public.pm_moisture_readings (project_id, org_id, kind, moisture_pct)
  values ('0c000000-0000-4000-8000-000000000001',
          '22222222-2222-2222-2222-222222222222', 'affected', 9.9);
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 11. Equipment: one job at a time, status kept in step ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  insert into public.pm_equipment (id, org_id, asset_tag, kind, capacity_pints_day, daily_rate_cents)
  values ('0d000000-0000-4000-8000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'DH-014', 'dehumidifier', 130, 4500);
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  insert into public.pm_equipment_placements (id, project_id, equipment_id, area_label, billed_rate_cents)
  values ('0d000000-0000-4000-8000-0000000000a1',
          '0c000000-0000-4000-8000-000000000001',
          '0d000000-0000-4000-8000-000000000001', 'Kitchen', 4500);
  \echo '--- expect: equipment now deployed'
  select asset_tag, status from public.pm_equipment
  where id = '0d000000-0000-4000-8000-000000000001';
commit;

\echo '--- the same asset cannot be on a second job while still out (expect ERROR)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  insert into public.pm_equipment_placements (project_id, equipment_id)
  select id, '0d000000-0000-4000-8000-000000000001'
  from public.pm_projects where project_number = 'PRJ-0002';
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_equipment_placements set removed_at = now()
  where id = '0d000000-0000-4000-8000-0000000000a1';
  \echo '--- expect: picking it up returns it to available'
  select asset_tag, status from public.pm_equipment
  where id = '0d000000-0000-4000-8000-000000000001';
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 12. Documentation: a technician provides, only a manager waives ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  insert into public.pm_documents (id, project_id, requirement_key, label, kind, is_blocking)
  values ('0aa00000-0000-4000-8000-000000000001',
          '0c000000-0000-4000-8000-000000000001',
          'authorization_to_perform', 'Signed authorization to perform', 'signature', true);
commit;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_documents set status = 'provided', external_ref = 'https://files/auth.pdf'
  where id = '0aa00000-0000-4000-8000-000000000001';
  \echo '--- expect: provided, stamped with the technician'
  select status, provided_at is not null as stamped,
         provided_by = '0a000000-0000-4000-8000-000000000002' as by_tech
  from public.pm_documents where id = '0aa00000-0000-4000-8000-000000000001';
rollback;

\echo '--- a technician cannot waive it (expect ERROR)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_documents set status = 'waived', waived_reason = 'customer verbal ok'
  where id = '0aa00000-0000-4000-8000-000000000001';
rollback;

\echo '--- a manager can, but not without a reason (expect ERROR then success)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  update public.pm_documents set status = 'waived'
  where id = '0aa00000-0000-4000-8000-000000000001';
rollback;
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  update public.pm_documents set status = 'waived', waived_reason = 'pre-existing loss, carrier agreed'
  where id = '0aa00000-0000-4000-8000-000000000001';
  \echo '--- expect: waived'
  select status, waived_reason from public.pm_documents
  where id = '0aa00000-0000-4000-8000-000000000001';
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 13. Alerts: deduplicated by fingerprint, identity immutable ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';

  insert into public.pm_alerts (project_id, rule_key, fingerprint, severity, category, title, occurrences)
  values ('0c000000-0000-4000-8000-000000000001', 'drying_reading_overdue',
          'drying_reading_overdue:0e000000-0000-4000-8000-000000000001', 'warn', 'drying',
          'No reading in Kitchen for 31 hours', 1);

  -- The engine's second pass: same finding, so update in place.
  insert into public.pm_alerts (project_id, rule_key, fingerprint, severity, category, title, occurrences)
  values ('0c000000-0000-4000-8000-000000000001', 'drying_reading_overdue',
          'drying_reading_overdue:0e000000-0000-4000-8000-000000000001', 'critical', 'drying',
          'No reading in Kitchen for 55 hours', 1)
  on conflict (org_id, fingerprint) do update
    set severity = excluded.severity,
        title = excluded.title,
        occurrences = public.pm_alerts.occurrences + 1,
        last_seen_at = now();

  \echo '--- expect: exactly 1 row, occurrences 2, severity critical'
  select count(*) as rows, max(occurrences) as occurrences, max(severity) as severity
  from public.pm_alerts;
commit;

\echo '--- the finding itself cannot be rewritten (expect ERROR)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_alerts set rule_key = 'something_harmless';
rollback;

\echo '--- occurrences cannot be walked back (expect ERROR)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_alerts set occurrences = 1;
rollback;

\echo '--- an engine-cleared alert records no human as having resolved it'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_alerts set status = 'resolved', resolution = 'cleared';
  \echo '--- expect: resolved / cleared / resolved_by null'
  select status, resolution, resolved_by is null as no_human, resolved_at is not null as stamped
  from public.pm_alerts;
rollback;

\echo '--- whereas a human handling it is recorded'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  update public.pm_alerts set status = 'resolved', resolution = 'handled';
  \echo '--- expect: resolved_by = the PM'
  select resolution, resolved_by = '0a000000-0000-4000-8000-000000000001' as by_pm
  from public.pm_alerts;
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 13b. The recurring-alert lifecycle (regression) ==='
\echo '    An alert fires, is cleared, and its condition comes back. Because'
\echo '    fingerprints are unique per org, the engine''s write lands on the'
\echo '    existing row — so it MUST continue the occurrence count, not restart'
\echo '    it. Restarting is what the guard refuses, and it would take the whole'
\echo '    automation pass down with it.'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';

  insert into public.pm_alerts (project_id, rule_key, fingerprint, title, occurrences)
  values ('0c000000-0000-4000-8000-000000000001', 'recur_rule', 'fp:recur', 'Reading overdue', 2);
  update public.pm_alerts set status = 'resolved', resolution = 'cleared'
  where fingerprint = 'fp:recur';

  \echo '--- WRONG (what a naive engine writes): occurrences back to 1 — expect ERROR'
  insert into public.pm_alerts (project_id, rule_key, fingerprint, title, occurrences, status)
  values ('0c000000-0000-4000-8000-000000000001', 'recur_rule', 'fp:recur', 'Reading overdue', 1, 'open')
  on conflict (org_id, fingerprint) do update
    set status = 'open', occurrences = excluded.occurrences;
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';

  insert into public.pm_alerts (project_id, rule_key, fingerprint, title, occurrences)
  values ('0c000000-0000-4000-8000-000000000001', 'recur_rule', 'fp:recur', 'Reading overdue', 2);
  update public.pm_alerts set status = 'resolved', resolution = 'cleared'
  where fingerprint = 'fp:recur';

  \echo '--- RIGHT (what the engine actually writes): count continues from 2'
  insert into public.pm_alerts (project_id, rule_key, fingerprint, title, occurrences, status)
  values ('0c000000-0000-4000-8000-000000000001', 'recur_rule', 'fp:recur', 'Reading overdue', 3, 'open')
  on conflict (org_id, fingerprint) do update
    set status = 'open', occurrences = excluded.occurrences, resolution = null;

  \echo '--- expect: open, 3 occurrences, resolution and resolved_by cleared'
  select status, occurrences, resolution is null as resolution_cleared,
         resolved_by is null as resolver_cleared
  from public.pm_alerts where fingerprint = 'fp:recur';
rollback;

\echo '\n=== 14. Drafted updates: born as drafts, immutable once approved ==='
\echo '--- an update cannot be created already approved (expect ERROR)'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  insert into public.pm_updates (project_id, audience, body, status)
  values ('0c000000-0000-4000-8000-000000000001', 'customer', 'All done!', 'approved');
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  insert into public.pm_updates (id, project_id, audience, subject, body, origin, model_id)
  values ('0ab00000-0000-4000-8000-000000000001',
          '0c000000-0000-4000-8000-000000000001', 'customer',
          'Update on your water loss', 'Drying is on track; two more days.',
          'agent', 'claude-sonnet-5');
  update public.pm_updates set status = 'approved' where id = '0ab00000-0000-4000-8000-000000000001';
  \echo '--- expect: approved, stamped with the PM'
  select status, approved_by = '0a000000-0000-4000-8000-000000000001' as by_pm
  from public.pm_updates where id = '0ab00000-0000-4000-8000-000000000001';

  \echo '--- rewriting the approved body is refused (expect ERROR)'
  update public.pm_updates set body = 'Actually we have not started.'
  where id = '0ab00000-0000-4000-8000-000000000001';
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 15. Project lifecycle timestamps ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  update public.pm_projects set phase = 'drying' where id = '0c000000-0000-4000-8000-000000000001';
  \echo '--- expect: started_at set by moving into drying, completed_at still null'
  select phase, started_at is not null as started, completed_at is null as not_done
  from public.pm_projects where id = '0c000000-0000-4000-8000-000000000001';

  update public.pm_projects set phase = 'invoicing' where id = '0c000000-0000-4000-8000-000000000001';
  update public.pm_projects set status = 'closed'   where id = '0c000000-0000-4000-8000-000000000001';
  \echo '--- expect: completed_at and closed_at both set'
  select completed_at is not null as completed, closed_at is not null as closed
  from public.pm_projects where id = '0c000000-0000-4000-8000-000000000001';
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 16. Nothing can be deleted (expect 3 ERRORs) ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  delete from public.pm_projects;
rollback;
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  delete from public.pm_moisture_readings;
rollback;
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000001';
  delete from public.pm_alerts;
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 17. anon reaches nothing (expect 0 rows / ERRORs) ==='
begin;
  set local role anon;
  select count(*) as projects_visible_to_anon from public.pm_projects;
rollback;

-- ---------------------------------------------------------------------------
\echo '\n=== 18. Settings: any member may create the defaults row, only a manager may tune it ==='
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  insert into public.pm_automation_settings (org_id) values ('11111111-1111-1111-1111-111111111111');
  \echo '--- expect: defaults, enabled, 24h reading interval'
  select enabled, timezone, reading_interval_hours, drying_stall_days, auto_create_tasks
  from public.pm_automation_settings;
commit;

\echo '--- a technician cannot move a threshold.'
\echo '    Expect UPDATE 0, not an ERROR: the USING clause hides the row from the'
\echo '    update rather than refusing it, which is how a SELECT-shaped denial reads.'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000002';
  update public.pm_automation_settings set reading_interval_hours = 168;
  \echo '--- expect: still 24, untouched'
  select reading_interval_hours from public.pm_automation_settings;
rollback;

\echo '--- an office manager can'
begin;
  set local role authenticated;
  set local request.jwt.claim.sub = '0a000000-0000-4000-8000-000000000003';
  update public.pm_automation_settings set reading_interval_hours = 12, disabled_rules = array['project_stale'];
  \echo '--- expect: 12 hours, one disabled rule'
  select reading_interval_hours, disabled_rules from public.pm_automation_settings;
rollback;

\echo '\n=== Done ==='
