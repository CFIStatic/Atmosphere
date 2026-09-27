-- Correct Content-Type on filed videos in the private job-proofs bucket.
--
-- A handful of WebM uploads were stored as application/octet-stream (or with
-- a codec parameter the storage API would not keep). Safari will not decode
-- those. The object bytes stay put; only metadata.mimetype changes.
-- Idempotent: rows that already advertise the right type are left alone.
-- Image stills in the same bucket are not video extensions and are skipped.

update storage.objects
set metadata = jsonb_set(
  coalesce(metadata, '{}'::jsonb),
  '{mimetype}',
  to_jsonb(
    case
      when lower(name) like '%.webm' then 'video/webm'
      when lower(name) like '%.mp4' then 'video/mp4'
      when lower(name) like '%.mov' then 'video/quicktime'
      when lower(name) like '%.avi' then 'video/x-msvideo'
      else coalesce(metadata->>'mimetype', 'application/octet-stream')
    end
  ),
  true
)
where bucket_id = 'job-proofs'
  and (
    lower(name) like '%.webm'
    or lower(name) like '%.mp4'
    or lower(name) like '%.mov'
    or lower(name) like '%.avi'
  )
  and coalesce(metadata->>'mimetype', '') is distinct from (
    case
      when lower(name) like '%.webm' then 'video/webm'
      when lower(name) like '%.mp4' then 'video/mp4'
      when lower(name) like '%.mov' then 'video/quicktime'
      when lower(name) like '%.avi' then 'video/x-msvideo'
      else coalesce(metadata->>'mimetype', 'application/octet-stream')
    end
  );
