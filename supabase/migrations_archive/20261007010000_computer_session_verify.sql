-- Check login (warm-up): short-lived sessions that open a saved site and report
-- signed-in vs login page. Same one-live-browser-per-org rule as login/logout.
alter table public.computer_sessions drop constraint if exists computer_sessions_purpose_check;
alter table public.computer_sessions
  add constraint computer_sessions_purpose_check
  check (purpose in ('task', 'login', 'logout', 'verify'));

comment on column public.computer_sessions.purpose is
  'task = Chat agent; login = person signing in on Logins; logout = clearing cookies on Remove; verify = Check login warm-up.';
