-- Global Admin video delete: queue for 30 days, then permanent purge.
-- deleted_at / deleted_by already stamp the hide; scheduled_purge_at is when
-- storage + the row may be removed (null = never auto-purge — legacy hides).

alter table public.job_proofs
  add column if not exists scheduled_purge_at timestamptz;

comment on column public.job_proofs.scheduled_purge_at is
  'When a Global Admin queued this clip for permanent removal. Null means the '
  'row stays hidden indefinitely (legacy soft-delete) or is still live. '
  'After this timestamp a worker may delete storage bytes and the row, unless '
  'a legal hold blocks it.';

comment on column public.job_proofs.deleted_at is
  'When a Global Admin queued this clip out of the library. Null means it is '
  'still visible. Bytes stay until scheduled_purge_at (if set) elapses.';

create index if not exists job_proofs_scheduled_purge_idx
  on public.job_proofs (scheduled_purge_at)
  where scheduled_purge_at is not null;
