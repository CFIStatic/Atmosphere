-- ---------------------------------------------------------------------------
-- Child privacy blur org policy (default ON — protect by default)
-- ---------------------------------------------------------------------------
-- When enabled, analysis detects minors by age appearance (child vs adult only)
-- and stores childPrivacyRedactions for player blur. Never identifies/names
-- children. See docs/child-privacy-redaction.md.

alter table public.orgs
  add column if not exists child_blur_enabled boolean not null default true;

comment on column public.orgs.child_blur_enabled is
  'Protective privacy: when true (default), detect children in Field Capture / '
  'job videos by age appearance only and blur them in players. Never identifies '
  'or names minors. Global Admin may disable.';
