-- ---------------------------------------------------------------------------
-- Per-video narration
-- ---------------------------------------------------------------------------
-- The day-level analysis compares the before to the after and says whether
-- work materially changed. This is the other report: one per video, written
-- by the model from that video's own frames against the shot list the crew
-- was given — what stage each moment shows, what work state is visible, and
-- which steps the walkthrough never covered.
--
-- Its own lifecycle column, deliberately separate from analysis_status: the
-- narration of the before video exists the moment the before lands, hours
-- ahead of any comparison, and a failed comparison must not read as a failed
-- narration or the other way round.

alter table public.job_proofs
  add column if not exists narration jsonb,
  add column if not exists narration_text text,
  add column if not exists narration_status text
    check (narration_status is null or narration_status in
      ('queued', 'running', 'done', 'skipped', 'failed')),
  add column if not exists narration_error text,
  add column if not exists narrated_at timestamptz;

comment on column public.job_proofs.narration is
  'The model''s reading of this one video: grounded per-frame entries plus '
  'coverage of the shot list, computed from the entries rather than claimed.';
comment on column public.job_proofs.narration_text is
  'The report attached to this video — a few sentences narrating it start to '
  'finish. Written only from what the frames show.';

create index if not exists job_proofs_narration_pending_idx
  on public.job_proofs (org_id)
  where narration_status in ('queued', 'failed');
