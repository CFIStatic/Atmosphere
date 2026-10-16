-- Storing a sealed refresh token does not survive Supabase's refresh-token
-- rotation: the moment the user's normal session refreshes, the stored copy is
-- revoked and PIN unlock breaks. Drop the stored token entirely and mint a
-- fresh session at unlock time instead. Nothing session-bearing is now at rest.

drop function if exists public.device_rotate_token(uuid, text, text);
drop function if exists public.enroll_device(text, text, text, text, text);
drop function if exists public.device_verify_pin(uuid, text, text);

alter table public.device_credentials drop column if exists enc_token;

create or replace function public.enroll_device(
  p_secret_hash text,
  p_pin_hash    text,
  p_pin_salt    text,
  p_label       text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- One PIN per user per device enrollment; re-enrolling replaces the old one
  -- so a user cannot accumulate forgotten devices that still unlock.
  delete from public.device_credentials where user_id = v_uid;

  insert into public.device_credentials (user_id, secret_hash, pin_hash, pin_salt, label)
  values (v_uid, p_secret_hash, p_pin_hash, p_pin_salt, p_label)
  returning id into v_id;

  return v_id;
end;
$$;

-- Returns the user to sign in as, never a token. The caller still has to prove
-- possession of the device secret, and the lockout counters are updated inside
-- the same transaction so concurrent guesses cannot outrun the limit.
create or replace function public.device_verify_pin(
  p_device_id   uuid,
  p_secret_hash text,
  p_pin_hash    text
) returns table (ok boolean, user_id uuid, locked_until timestamptz, attempts_left int)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d public.device_credentials%rowtype;
begin
  select * into d
  from public.device_credentials
  where id = p_device_id and secret_hash = p_secret_hash
  for update;

  if not found then
    return query select false, null::uuid, null::timestamptz, 0;
    return;
  end if;

  if d.locked_until is not null and d.locked_until > now() then
    return query select false, null::uuid, d.locked_until, 0;
    return;
  end if;

  if d.pin_hash = p_pin_hash then
    update public.device_credentials
       set failed_attempts = 0, lockouts = 0, locked_until = null, last_used_at = now()
     where id = d.id;
    return query select true, d.user_id, null::timestamptz, 5;
    return;
  end if;

  if d.failed_attempts + 1 >= 5 then
    if d.lockouts + 1 >= 3 then
      delete from public.device_credentials where id = d.id;
      return query select false, null::uuid, null::timestamptz, 0;
      return;
    end if;
    update public.device_credentials
       set failed_attempts = 0, lockouts = d.lockouts + 1, locked_until = now() + interval '15 minutes'
     where id = d.id;
    return query select false, null::uuid, now() + interval '15 minutes', 0;
    return;
  end if;

  update public.device_credentials
     set failed_attempts = d.failed_attempts + 1
   where id = d.id;
  return query select false, null::uuid, null::timestamptz, 5 - (d.failed_attempts + 1);
end;
$$;

revoke all on function public.enroll_device(text, text, text, text) from public;
revoke all on function public.device_verify_pin(uuid, text, text) from public;
revoke execute on function public.enroll_device(text, text, text, text) from anon;
grant execute on function public.enroll_device(text, text, text, text) to authenticated;
grant execute on function public.device_verify_pin(uuid, text, text) to anon, authenticated;