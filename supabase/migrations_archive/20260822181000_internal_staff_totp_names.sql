-- Remember the staff name that was typed at first Authenticator enrollment
-- so later visits only need email + the 6-digit code (the password).

alter table public.internal_staff_totp
  add column if not exists first_name text,
  add column if not exists last_name text;
