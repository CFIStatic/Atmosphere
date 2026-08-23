-- ---------------------------------------------------------------------------
-- Automatic legal holds
-- ---------------------------------------------------------------------------
-- Preservation was a button on the customer's job file. That is the wrong
-- hand on the switch. The party most likely to want a clip gone is the party
-- who was standing in front of the camera, and asking them to freeze the file
-- for a lawsuit they are a side in is asking the wrong question of the wrong
-- person at the wrong moment.
--
-- So the switch moves inside. Atmosphere's own rules watch the monitor and
-- open a preservation hold on the signal — video deleted after an outside
-- party read the file, a burst of deletes on one job, a job being worked from
-- the outside. Staff review and release; the customer is not consulted and
-- cannot lift it.
--
-- Two columns carry that: where a hold came from, and which rule brought it.

do $$ begin
  create type legal_hold_origin as enum ('staff', 'automatic');
exception when duplicate_object then null; end $$;

alter table public.legal_holds
  add column if not exists origin legal_hold_origin not null default 'staff',
  add column if not exists auto_rule text
    check (auto_rule is null or length(auto_rule) between 1 and 64),
  add column if not exists review_by timestamptz;

comment on column public.legal_holds.origin is
  'staff = a person opened it. automatic = a preservation rule fired on a '
  'monitor signal. Customers open neither.';

comment on column public.legal_holds.auto_rule is
  'Which rule fired, for an automatic hold. Null for staff holds.';

comment on column public.legal_holds.review_by is
  'When staff should look at an automatic hold and decide to keep it. '
  'Nothing releases on its own — an expired review is a queue, not a purge.';

-- The desk opens on "what fired and has nobody looked at it yet".
create index if not exists legal_holds_auto_review_idx
  on public.legal_holds (review_by)
  where origin = 'automatic' and status = 'open';

-- An automatic hold is opened by the platform, not by a signed-in person, so
-- created_by is null on those rows. Keep the release path honest: a release
-- still names a human.
alter table public.legal_holds
  drop constraint if exists legal_holds_auto_rule_with_origin;
alter table public.legal_holds
  add constraint legal_holds_auto_rule_with_origin check (
    (origin = 'automatic') or auto_rule is null
  );
