-- Tighten ask_job_notes inserts.
--
-- The previous policy let any authenticated user insert a note when
-- owner_user_id matched auth.uid(), including for an org they do not belong
-- to and a job that is not in that org. This replaces that policy.
-- Share-token writes use the service role and bypass RLS.
-- job_proof_questions and the other custody tables are not altered.

drop policy if exists ask_job_notes_insert on public.ask_job_notes;

create policy ask_job_notes_insert_member_job on public.ask_job_notes
  for insert to authenticated
  with check (
    private.is_org_member(org_id)
    and owner_user_id = auth.uid()
    and exists (
      select 1
      from public.crm_jobs
      where crm_jobs.id = job_id
        and crm_jobs.org_id = ask_job_notes.org_id
    )
  );
