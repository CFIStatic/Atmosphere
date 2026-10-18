-- Soft-delete stamps job_proofs.deleted_at. The SELECT policy also hid those
-- rows (deleted_at is null). Postgres applies SELECT policies as an implicit
-- WITH CHECK on UPDATE, so the hide itself failed:
--   new row violates row-level security policy for table "job_proofs"
--
-- Let the member who hid the clip still "see" that new row so the stamp
-- succeeds. Library views (job_evidence_items, job_proof_days) keep filtering
-- deleted_at is null, so the dashboard does not list it.

drop policy if exists job_proofs_select on public.job_proofs;
create policy job_proofs_select on public.job_proofs
  for select to authenticated
  using (
    private.is_org_member(org_id)
    and (deleted_at is null or deleted_by = auth.uid())
  );

drop policy if exists media_objects_select_member on public.media_objects;
create policy media_objects_select_member on public.media_objects
  for select using (
    org_id in (select org_id from public.org_members where user_id = auth.uid())
    and (
      (deleted_at is null and state <> 'deleted')
      or deleted_by = auth.uid()
    )
  );
