-- ---------------------------------------------------------------------------
-- Video labels
-- ---------------------------------------------------------------------------
-- The historical library's index. Every filed clip already accumulates rich
-- structure — the narration's stage coverage, the phase, the trade, the
-- analyst's verdicts — but structure buried in jsonb is structure a search
-- cannot touch. Labels flatten the queryable facts into one indexed array,
-- written when the narration lands and never edited by hand.
--
-- Derived data, deliberately: labels can always be recomputed from the
-- narration and the row, so this column is an index, not a record. The GIN
-- index is what makes "every flood-cut video across every job, ever" a
-- millisecond query instead of a jsonb crawl.

alter table public.job_proofs
  add column if not exists labels text[] not null default '{}';

create index if not exists job_proofs_labels_idx
  on public.job_proofs using gin (labels);

comment on column public.job_proofs.labels is
  'Flat searchable index of this clip: phase, trade, stage kinds and scope '
  'areas the narration saw. Derived from the narration — recomputable, never '
  'hand-edited.';
