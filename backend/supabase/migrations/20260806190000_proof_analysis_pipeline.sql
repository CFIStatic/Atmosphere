-- ---------------------------------------------------------------------------
-- The analysis pipeline gets a lifecycle
-- ---------------------------------------------------------------------------
-- Until now the model ran inline during the subcontractor's upload request and
-- every failure was swallowed. That had three problems, and each one is a
-- column here:
--
--   A day the model could not read looked identical to a day nobody asked it
--   about. "Not analysed" and "analysis failed" are different facts — one is a
--   gap, the other is a breakage somebody can retry — and the record could not
--   say which.
--
--   The model ran while the crew stood in a doorway waiting for their upload
--   to finish. A twenty-second vision call does not belong inside a phone's
--   POST request on a truck's signal.
--
--   The verdict the general contractor actually wants — did the work
--   materially change between the two videos — was implied by the summary but
--   never stated, so nothing could sort by it, filter on it, or put it in the
--   chain of custody.
--
-- Analysis state is deliberately its own column rather than more values on the
-- custody enum (`state`). Whether a day was accepted and whether the model has
-- read it are independent facts: a rejected day can still be analysed, an
-- accepted one may never have been. Folding them into one column would force
-- an ordering that does not exist.

alter table public.job_proofs
  add column if not exists analysis_status text
    check (analysis_status in ('queued', 'running', 'done', 'skipped', 'failed')),
  add column if not exists analysis_error text,
  add column if not exists analysis_attempts integer not null default 0,
  add column if not exists analysed_at timestamptz,
  -- The headline verdict, stated rather than implied. 'none' is not a failure:
  -- "you claimed a day and the footage shows nothing changed" is exactly the
  -- sentence this feature exists to produce.
  add column if not exists ai_material_change text
    check (ai_material_change in ('significant', 'minor', 'none', 'unclear'));

comment on column public.job_proofs.analysis_status is
  'Lifecycle of the model read, independent of the custody state. failed is '
  'retryable and visible; skipped records why nothing could run.';

comment on column public.job_proofs.ai_material_change is
  'Did the work area visibly change between before and after. Grounded only in '
  'what the frames show — never inferred from hours claimed or scope expected.';

-- The retry sweep and the dashboard both ask "what is stuck" — keep that an
-- index lookup rather than a scan of a season of video rows.
create index if not exists job_proofs_analysis_pending_idx
  on public.job_proofs (org_id, work_date desc)
  where analysis_status in ('queued', 'failed');
