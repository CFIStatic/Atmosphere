-- Intentionally dropped. The original body updated job_evidence_access.actor_id,
-- and private.job_evidence_access_append_only rejected it: the chain of custody
-- cannot be edited or deleted. Attribution already uses job_parties.created_by,
-- and new uploads write actor_id when the row is inserted. This version stays
-- so the ledger records a no-op instead of that update.

select 1;
