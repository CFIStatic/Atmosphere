-- Second half of 20261018230000_lock_down_direct_writes.sql: make the RPCs the
-- previous BFF called with a user token server-only. Apply AFTER the backend
-- that calls join_org_as / set_billing_settings_as / the service-role token
-- usage writer / the service-role Stripe customer link is live; applying it
-- earlier breaks invite joins, billing settings, first checkout and token
-- usage recording on the old code until the deploy finishes.
--
-- - join_org: anyone holding a workspace's join code could join it, as a role
--   of their choosing, with no invite.
-- - set_billing_settings / record_token_usage: billing and usage writes.
-- - link_stripe_customer: an owner could point their workspace at another
--   company's Stripe customer.

revoke execute on function public.set_billing_settings(uuid, boolean, bigint, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.set_billing_settings(uuid, boolean, bigint, bigint, bigint, boolean) to service_role;

revoke execute on function public.record_token_usage(uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz, bigint, text, bigint, bigint, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_token_usage(uuid, text, text, text, uuid, uuid, text, bigint, bigint, bigint, bigint, jsonb, timestamptz, bigint, text, bigint, bigint, bigint, jsonb, text) to service_role;

revoke execute on function public.link_stripe_customer(uuid, text) from public, anon, authenticated;
grant execute on function public.link_stripe_customer(uuid, text) to service_role;

revoke execute on function public.join_org(text, public.member_role, public.work_type) from public, anon, authenticated;
grant execute on function public.join_org(text, public.member_role, public.work_type) to service_role;
