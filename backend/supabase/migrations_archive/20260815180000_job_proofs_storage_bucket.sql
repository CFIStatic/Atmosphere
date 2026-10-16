-- Ensure the hot proof/media bucket exists with a day-file-friendly size cap.
-- Client uploads use service-role-minted signed URLs; no INSERT policy needed
-- on storage.objects for anon/authenticated.

insert into storage.buckets (id, name, public, file_size_limit)
values ('job-proofs', 'job-proofs', false, 85899345920)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = coalesce(storage.buckets.file_size_limit, excluded.file_size_limit);
