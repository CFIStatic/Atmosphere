-- Profile photos. Teammates see this next to the display name in the
-- linked-accounts list; the initials bubble is only the fallback.
--
-- avatar_url holds either a public storage URL or a small data URL when
-- object storage is not configured on that deployment.

alter table public.profiles
  add column if not exists avatar_url text;

comment on column public.profiles.avatar_url is
  'HTTPS or data URL for the profile photo teammates see next to the display name.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Authenticated users may replace only the object under their own user id.
-- Public read is via the public bucket URL; no SELECT policy is required.

drop policy if exists avatars_storage_insert on storage.objects;
create policy avatars_storage_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_storage_update on storage.objects;
create policy avatars_storage_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_storage_delete on storage.objects;
create policy avatars_storage_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
