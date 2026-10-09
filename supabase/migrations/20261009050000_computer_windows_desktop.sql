-- A Computer session can now run on an org's Windows desktop ('windows'),
-- not only the cloud browser. The desktop runs apps like Xactimate that have
-- no web page; its own disk keeps the app and its sign-in between tasks.
alter table public.computer_sessions drop constraint if exists computer_sessions_provider_check;
alter table public.computer_sessions
  add constraint computer_sessions_provider_check
  check (provider in ('browserbase', 'windows', 'mock'));

comment on constraint computer_sessions_provider_check on public.computer_sessions is
  'browserbase = cloud browser; windows = the org''s Windows desktop; mock = tests.';
