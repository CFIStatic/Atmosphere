-- ---------------------------------------------------------------------------
-- First-class clip identity on job_proofs
-- ---------------------------------------------------------------------------
-- Multi-clip storage encodes the recording id in the object path
-- (…/YYYY-MM-DD-phase-<clipId>.ext). Without a column, ops cannot search by
-- that id, and stale Field Capture clients that omit clipId still collide on
-- the legacy day/phase stem. Persist clip_id on every new row; backfill from
-- existing paths. Unique per org when present so each film is searchable.

alter table public.job_proofs
  add column if not exists clip_id text;

comment on column public.job_proofs.clip_id is
  'Phone- or server-minted recording id (lowercase alnum, 6–32). Unique per '
  'org when set. Encoded in storage_path for new uploads; null only on legacy '
  'one-per-day paths filed before multi-clip.';

-- Pull clip id out of paths that already carry it.
update public.job_proofs
set clip_id = substring(
  storage_path
  from '[0-9]{4}-[0-9]{2}-[0-9]{2}-(?:before|after)-([a-z0-9]{6,32})\\.[a-z0-9]{2,5}$'
)
where clip_id is null
  and storage_path ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}-(?:before|after)-[a-z0-9]{6,32}\\.[a-z0-9]{2,5}$';

create unique index if not exists job_proofs_org_clip_id_uidx
  on public.job_proofs (org_id, clip_id)
  where clip_id is not null;

create index if not exists job_proofs_clip_id_idx
  on public.job_proofs (clip_id)
  where clip_id is not null;
