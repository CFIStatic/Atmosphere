-- A job file is a video repository: every recording is its own row.
--
-- 20260822183000 dropped job_proofs_one_per_phase and immediately put back a
-- unique index on (party_id, work_date, phase) for visible rows, so a second
-- film the same day still replaced the first. Field Capture now mints a clip
-- id per recording and files each as its own storage object. This unique
-- rule would reject that insert. Lookups still use job_proofs_party_idx.

drop index if exists public.job_proofs_one_visible_phase;
