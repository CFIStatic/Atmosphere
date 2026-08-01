-- ============================================================================
-- Growth analytics — expand feature catalog for full product coverage
-- ============================================================================
-- Earlier growth migrations instrumented a short list of tools. The internal
-- product-intelligence view needs every major Atmosphere surface as a catalog
-- row so unused areas show up as zeros (and as cut / stickiness candidates),
-- not as missing data.
-- ============================================================================

insert into public.feature_catalog (key, label, area, description, sort_order) values
  ('jobs',                    'Jobs',                    'Field ops',    'Job list, filters, and creating work',                         130),
  ('job_detail',              'Job detail',              'Field ops',    'Single-job record, notes, and status changes',                 140),
  ('memory',                  'Agent memory',            'Field ops',    'Per-job and personal memory feed',                             150),
  ('team_memory',             'Team memory',             'Field ops',    'Org-wide memory shared across the crew',                       160),
  ('technician',              'Field assistant',         'Field ops',    'Voice / on-site technician assistant',                         170),
  ('computer_use',            'Computer use',            'Automation',   'Paired machines Claude can operate',                           180),
  ('construction_estimator',  'Construction estimator',  'Estimating',   'Construction scope, photos, and Xactimate write-back',         190),
  ('mitigation_estimator',    'Mitigation estimator',    'Estimating',   'Mitigation drying-scope estimates',                            200),
  ('project_manager',         'Project manager',         'Field ops',    'PM board, alerts, drying, and scheduling',                     210),
  ('settings',                'Settings',                'Platform',     'Account and org preferences',                                  220),
  ('usage_console',           'Usage',                   'Back office',  'AI usage and metering overview',                               230)
on conflict (key) do update
  set label = excluded.label,
      area = excluded.area,
      description = excluded.description,
      sort_order = excluded.sort_order,
      is_active = true;

-- Keep labels honest for tools that already existed.
update public.feature_catalog
set label = 'Audit ledger',
    description = 'Every agent run and step the org can replay'
where key = 'agent_console';

update public.feature_catalog
set description = 'Connecting and running external portal automation'
where key = 'web_connections';
