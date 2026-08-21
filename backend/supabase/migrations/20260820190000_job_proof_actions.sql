-- Timestamped work actions the vision model saw in a filed day film.
--
-- Narration_text is the office-facing prose. This column is the structured
-- log: one entry per distinct action, with a video offset, a closed verb
-- from episodes/actions.ts, and the objects / tools / materials in shot.
-- Recomputed on re-read. Humans review via episode_actions.validated_at.

alter table public.job_proofs
  add column if not exists actions jsonb not null default '[]'::jsonb;

alter table public.job_proofs
  drop constraint if exists job_proofs_actions_is_array;

alter table public.job_proofs
  add constraint job_proofs_actions_is_array
  check (jsonb_typeof(actions) = 'array');

comment on column public.job_proofs.actions is
  'AI vision log of work actions in this day film: [{atSeconds, action, '
  'description, objectLabel, toolLabel, materialLabel, objects, confidence, '
  'model}]. Closed action verbs. Derived on read — never hand-edited here.';
