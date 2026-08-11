-- Pin the trigger function's search_path. Without it, whatever schema list the
-- calling session happens to have set decides which `now()` runs — so a
-- shadowing function in an attacker-controlled schema could be reached from a
-- trigger. Empty search_path plus a fully-qualified call removes the question.
create or replace function public.web_access_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;