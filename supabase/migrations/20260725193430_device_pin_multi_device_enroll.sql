-- Enrolling on a second device must not silently disable the first: a project
-- manager with a phone and a laptop expects a PIN on both. Keep one row per
-- device, replace the row for *this* device when changing a PIN, and cap the
-- total so abandoned enrollments cannot pile up forever.

drop function if exists public.enroll_device(text, text, text, text);

create or replace function public.enroll_device(
  p_secret_hash        text,
  p_pin_hash           text,
  p_pin_salt           text,
  p_label              text default null,
  p_replace_device_id  uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_max constant int := 5;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Changing the PIN on a device already enrolled: drop that row so the old
  -- PIN stops working rather than lingering as a second valid credential.
  if p_replace_device_id is not null then
    delete from public.device_credentials
     where id = p_replace_device_id and user_id = v_uid;
  end if;

  -- Keep only the most recently used enrollments, making room for the new one.
  delete from public.device_credentials
   where id in (
     select id from public.device_credentials
      where user_id = v_uid
      order by coalesce(last_used_at, created_at) desc
      offset v_max - 1
   );

  insert into public.device_credentials (user_id, secret_hash, pin_hash, pin_salt, label)
  values (v_uid, p_secret_hash, p_pin_hash, p_pin_salt, p_label)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.enroll_device(text, text, text, text, uuid) from public;
revoke execute on function public.enroll_device(text, text, text, text, uuid) from anon;
grant execute on function public.enroll_device(text, text, text, text, uuid) to authenticated;