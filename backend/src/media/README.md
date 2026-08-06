# Media catalog (fleet video)

One object ≤ ~24h. Fleet scale = many objects in object storage + this catalog.

See `/docs/media-storage.md` for the architecture.

| Module | Role |
|---|---|
| `types.ts` | Catalog / quota / session shapes (`hasAudio`) |
| `capturePolicy.ts` | Field day / proof video must include mic track |
| `driver.ts` | `MediaStorageDriver` (supabase / s3 stub / memory) |
| `quotas.ts` | Soft org ceiling checks |
| `catalog.ts` | In-process catalog + upload sessions |
| `../routes/mediaCatalog.ts` | `/api/media/catalog/*` |
| `../supabase/migrations/20260815090000_media_catalog.sql` | Durable tables |
| `../supabase/migrations/20260815120000_media_has_audio.sql` | `has_audio` column |
