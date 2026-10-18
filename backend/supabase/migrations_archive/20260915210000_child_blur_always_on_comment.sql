-- ---------------------------------------------------------------------------
-- Child blur is always on in application code. Refresh the column comment so
-- schema docs no longer claim Global Admin may disable it. No data change.
-- ---------------------------------------------------------------------------

comment on column public.orgs.child_blur_enabled is
  'Legacy org flag (default true). Application code always enables child '
  'privacy blur for every org — detection, player blur, and Ask redaction. '
  'Stored false is ignored. Never identifies or names minors. See '
  'docs/child-privacy-redaction.md.';
