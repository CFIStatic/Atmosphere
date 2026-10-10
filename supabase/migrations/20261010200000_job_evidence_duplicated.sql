-- A duplicated job file is a custody event on both sides: the original records
-- that its clips were copied out, and the copy records where its clips came
-- from (instead of claiming they were filed there). Its own file because a new
-- enum value cannot be used in the transaction that adds it.
alter type public.job_evidence_action add value if not exists 'duplicated';
