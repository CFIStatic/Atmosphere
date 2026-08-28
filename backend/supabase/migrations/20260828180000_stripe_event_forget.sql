-- Release a claimed Stripe event so a failed handler can be retried.
-- stripe_event_seen inserts first; without a matching forget, a 500 still
-- leaves the id marked seen and Stripe's retry is treated as a duplicate.

create or replace function public.stripe_event_forget(p_event_id text)
returns void language plpgsql security definer
set search_path to 'private','public','pg_temp' as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'service_role_required' using errcode = '42501';
  end if;
  delete from private.stripe_events where id = p_event_id;
end $$;

revoke execute on function public.stripe_event_forget(text) from public, anon, authenticated;
