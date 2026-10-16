-- Field Capture on a physical iPhone talks to this project directly (no local
-- BFF). Org members need to upload day films into job-proofs under {org_id}/...
-- Upsert requires INSERT + SELECT + UPDATE on storage.objects.

drop policy if exists job_proofs_storage_select on storage.objects;
create policy job_proofs_storage_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'job-proofs'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.org_members where user_id = auth.uid()
    )
  );

drop policy if exists job_proofs_storage_insert on storage.objects;
create policy job_proofs_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-proofs'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.org_members where user_id = auth.uid()
    )
  );

drop policy if exists job_proofs_storage_update on storage.objects;
create policy job_proofs_storage_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'job-proofs'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.org_members where user_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'job-proofs'
    and (storage.foldername(name))[1] in (
      select org_id::text from public.org_members where user_id = auth.uid()
    )
  );
