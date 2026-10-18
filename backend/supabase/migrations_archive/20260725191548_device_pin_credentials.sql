-- Device-bound PIN unlock.
--
-- A PIN is a 4-digit convenience credential, NOT a standalone one: it can only
-- unlock a device that already completed a full email+password login. The row
-- below is useless without the device secret, which lives solely in the user's
-- httpOnly cookie and is never stored here (only its SHA-256).

create table if not exists public.device_credentials (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  -- sha256(device_secret). The secret itself exists only in the client cookie.
  secret_hash     text not null,
  -- scrypt(pin, pin_salt, server pepper), computed in the backend. The raw PIN
  -- never reaches the database.
  pin_hash        text not null,
  pin_salt        text not null,
  -- Supabase refresh token sealed with AES-256-GCM under a key derived from the
  -- device secret. A database leak alone therefore cannot decrypt it.
  enc_token       text not null,
  failed_attempts int  not null default 0,
  lockouts        int  not null default 0,
  locked_until    timestamptz,
  label           text,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz
);

create index if not exists device_credentials_user_id_idx on public.device_credentials(user_id);

alter table public.device_credentials enable row level security;

-- Users may see and delete their own devices (for a "manage devices" view).
-- All writes go through the SECURITY DEFINER functions below so that lockout
-- counters cannot be tampered with by a client holding the anon key.
drop policy if exists device_credentials_select_own on public.device_credentials;
create policy device_credentials_select_own on public.device_credentials
  for select to authenticated using (user_id = auth.uid());

drop policy if exists device_credentials_delete_own on public.device_credentials;
create policy device_credentials_delete_own on public.device_credentials
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Enrollment: called with the user's JWT immediately after a full login.
-- ---------------------------------------------------------------------------
create or replace function public.enroll_device(
  p_secret_hash text,
  p_pin_hash    text,
  p_pin_salt    text,
  p_enc_token   text,
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

  insert into public.device_credentials (user_id, secret_hash, pin_hash, pin_salt, enc_token, label)
  values (v_uid, p_secret_hash, p_pin_hash, p_pin_salt, p_enc_token, p_label)
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lookup: returns the salt needed to derive the PIN hash, only to a caller that
-- already proves possession of the device secret. Callable pre-authentication.
-- ---------------------------------------------------------------------------
create or replace function public.device_lookup(
  p_device_id   uuid,
  p_secret_hash text
) returns table (pin_salt text, locked_until timestamptz)
language sql
security definer
set search_path = public, pg_temp
as $$
  select d.pin_salt, d.locked_until
  from public.device_credentials d
  where d.id = p_device_id and d.secret_hash = p_secret_hash;
$$;

-- ---------------------------------------------------------------------------
-- Verify: atomically checks the lockout window, compares the PIN hash, and
-- updates counters in a single statement so concurrent guesses cannot race past
-- the limit. 5 wrong PINs => 15 minute lockout; 3 lockouts => device is deleted
-- and the user must sign in with their password again.
-- ---------------------------------------------------------------------------
create or replace function public.device_verify_pin(
  p_device_id   uuid,
  p_secret_hash text,
  p_pin_hash    text
) returns table (ok boolean, enc_token text, locked_until timestamptz, attempts_left int)
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
    return query select false, null::text, null::timestamptz, 0;
    return;
  end if;

  if d.locked_until is not null and d.locked_until > now() then
    return query select false, null::text, d.locked_until, 0;
    return;
  end if;

  if d.pin_hash = p_pin_hash then
    update public.device_credentials
       set failed_attempts = 0, lockouts = 0, locked_until = null, last_used_at = now()
     where id = d.id;
    return query select true, d.enc_token, null::timestamptz, 5;
    return;
  end if;

  -- Wrong PIN.
  if d.failed_attempts + 1 >= 5 then
    if d.lockouts + 1 >= 3 then
      delete from public.device_credentials where id = d.id;
      return query select false, null::text, null::timestamptz, 0;
      return;
    end if;
    update public.device_credentials
       set failed_attempts = 0, lockouts = d.lockouts + 1, locked_until = now() + interval '15 minutes'
     where id = d.id;
    return query select false, null::text, now() + interval '15 minutes', 0;
    return;
  end if;

  update public.device_credentials
     set failed_attempts = d.failed_attempts + 1
   where id = d.id;
  return query select false, null::text, null::timestamptz, 5 - (d.failed_attempts + 1);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rotate: Supabase rotates refresh tokens on every use, so the sealed token has
-- to be replaced after each successful unlock.
-- ---------------------------------------------------------------------------
create or replace function public.device_rotate_token(
  p_device_id   uuid,
  p_secret_hash text,
  p_enc_token   text
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.device_credentials
     set enc_token = p_enc_token, last_used_at = now()
   where id = p_device_id and secret_hash = p_secret_hash;
$$;

-- ---------------------------------------------------------------------------
-- Revoke every device for the current user (used after a password reset).
-- ---------------------------------------------------------------------------
create or replace function public.revoke_my_devices()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  delete from public.device_credentials where user_id = v_uid;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Least-privilege grants.
revoke all on function public.enroll_device(text, text, text, text, text) from public;
revoke all on function public.device_lookup(uuid, text) from public;
revoke all on function public.device_verify_pin(uuid, text, text) from public;
revoke all on function public.device_rotate_token(uuid, text, text) from public;
revoke all on function public.revoke_my_devices() from public;

grant execute on function public.enroll_device(text, text, text, text, text) to authenticated;
grant execute on function public.revoke_my_devices() to authenticated;
-- The unlock path runs before the user has a session, so anon must reach these.
grant execute on function public.device_lookup(uuid, text) to anon, authenticated;
grant execute on function public.device_verify_pin(uuid, text, text) to anon, authenticated;
grant execute on function public.device_rotate_token(uuid, text, text) to anon, authenticated;