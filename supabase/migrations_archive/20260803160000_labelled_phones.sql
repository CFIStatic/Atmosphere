-- Labelled phone numbers on a revealed prospect.
--
-- Two flat columns, `phone` and `mobile`, could not say the thing that
-- actually matters when somebody is about to dial: which number is the desk
-- line, which is the work cell, and which is a private number that was never
-- published to be called about business. They also could not record whether
-- anybody had checked the number was assigned at all — phones had no
-- equivalent of the email verification ladder, so a disconnected line looked
-- exactly like a working one.
--
-- The array carries one object per number:
--
--   { number, kind, lineType, carrier, valid, verifier, source }
--
--   kind      work | mobile | personal | unknown  — what to call it
--   lineType  landline | mobile | voip | tollfree — what the carrier says
--   valid     true | false | null                 — null means UNCHECKED, and
--                                                   must never render as
--                                                   "does not work"
--
-- The flat columns stay, in step with the array, so anything already reading
-- them keeps working. They are the summary; this is the record.

alter table public.crm_prospects
  add column if not exists phones jsonb not null default '[]'::jsonb;

comment on column public.crm_prospects.phones is
  'Labelled numbers: [{number, kind, lineType, carrier, valid, verifier, source}]. kind distinguishes a published work line from a private cell; valid=null means nothing checked it.';

-- Guard the shape rather than trusting every future writer to get it right.
alter table public.crm_prospects
  drop constraint if exists crm_prospects_phones_is_array;
alter table public.crm_prospects
  add constraint crm_prospects_phones_is_array
  check (jsonb_typeof(phones) = 'array');

-- Finding "everyone with a reachable mobile in this territory" is a normal
-- thing to want, and without an index it is a scan of every prospect.
create index if not exists crm_prospects_phones_idx
  on public.crm_prospects using gin (phones jsonb_path_ops);
