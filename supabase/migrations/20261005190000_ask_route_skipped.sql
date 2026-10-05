-- Allow logging overview / deterministic paths that never call a model.
alter table public.ask_route_decisions
  drop constraint if exists ask_route_decisions_route_check;

alter table public.ask_route_decisions
  add constraint ask_route_decisions_route_check
  check (route in ('fast', 'deep', 'skipped'));
