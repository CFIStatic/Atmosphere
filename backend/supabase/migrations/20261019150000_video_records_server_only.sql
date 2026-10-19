-- Video evidence is write-once for anyone holding a user token.
--
-- The browser and the iPhone app hold the user's Supabase access token and the
-- publishable key (see 20261018230000_lock_down_direct_writes.sql), so any
-- workspace member, an Employee included, could call PostgREST / Storage
-- directly and:
--
-- 1. Overwrite a video file. `job_proofs_storage_update` let members replace
--    any object in their workspace's job-proofs folder (an upsert), destroying
--    the original bytes. Uploads still work: they go through BFF-minted signed
--    URLs (no RLS), and the iPhone offline fallback only creates new objects,
--    which `job_proofs_storage_insert` keeps allowing. Deleting objects was
--    already blocked (`job_proofs_storage_no_delete`).
--
-- 2. Rewrite a video's record. `job_proofs_update`, `video_clips_update` and
--    `verification_videos_update` let members hide a clip (deleted_at) without
--    the Global Admin check or audit trail, repoint storage_path, clear a legal
--    hold, or rewrite transcripts and AI summaries. Every update in the app runs
--    on the server with the service role; nothing writes these rows with a user
--    token. Inserts stay (the iPhone offline fallback files a new job_proofs
--    row), and reads are unchanged.

drop policy if exists job_proofs_storage_update on storage.objects;

drop policy if exists job_proofs_update on public.job_proofs;
drop policy if exists video_clips_update on public.video_clips;
drop policy if exists verification_videos_update on public.verification_videos;

revoke update, delete, truncate on public.job_proofs from anon, authenticated;
revoke update, delete, truncate on public.video_clips from anon, authenticated;
revoke update, delete, truncate on public.verification_videos from anon, authenticated;
