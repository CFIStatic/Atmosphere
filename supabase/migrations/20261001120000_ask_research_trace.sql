-- Compact research trace for a stored Ask answer.
--
-- Queries, tool names, counts, and timings only. No transcript text.
-- Empty when the question took the single pass. The office UI does not render this.

alter table public.job_proof_questions
  add column if not exists research_trace jsonb;

comment on column public.job_proof_questions.research_trace is
  'Debug metadata for multi-step Ask: route, stop reason, and per-step queries, tools, counts, and timings. Null on the single pass. Not shown in the product.';
