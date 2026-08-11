-- Restore EXECUTE on private.is_org_member for authenticated callers.
--
-- 20260727190000_mitigation_estimator.sql revoked ALL from public/anon/
-- authenticated and never re-granted. RLS policies and RPCs call this helper
-- as the signed-in user, so create_org / membership checks failed with:
--   permission denied for function is_org_member
--
-- Pattern matches private.estimator_is_org_member: revoke from public, then
-- grant only to authenticated (security definer still runs as owner).

revoke all on function private.is_org_member(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.is_org_member(uuid) to service_role;
