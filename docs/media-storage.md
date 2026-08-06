# Media storage — 24h objects, fleet-scale hours

## The scale model

| Concern | Rule |
|---|---|
| **One video** | At most ~**24 hours** of timeline (`PROOF_MAX_DURATION_SECONDS`, default 86400). A field day is one object. |
| **The platform** | Retains **many** such objects across orgs — toward **billions of hours** in aggregate — in **object storage**. |
| **Postgres** | Holds the **catalog** (`media_objects`: id, bytes, duration, tier, key). Never the bytes. |
| **API** | Mints signed upload/read URLs (or multipart plans). Never streams multi‑GB bodies through Express. |

We do **not** stretch one file past 24h to grow capacity. Capacity is **object count × tiering × retention**.

## Tiers

| Tier | Intent |
|---|---|
| **hot** | Recent playback / verification (Supabase or S3 standard) |
| **warm** | Infrequent review (S3 IA / equivalent) |
| **cold** | Legal / long retain (Glacier-class / archive bucket) |

Lifecycle rules in the bucket move bytes; the catalog’s `tier` column tracks what the product believes.

## Drivers

`MediaStorageDriver` (`backend/src/media/driver.ts`):

- **supabase** — today’s hot path (signed upload/read on `job-proofs` / `MEDIA_HOT_BUCKET`)
- **s3** — multipart-oriented stub for App Store / day-length uploads + archive bucket
- **memory** — unit tests only

Proof upload and twin `videoRef` should converge on `media_objects.id` so intelligence (`/api/media/video/process`) only needs a signed read URL.

## API

- `GET /api/media/catalog/scale` — caps and backend knobs
- `POST /api/media/catalog/uploads` — begin session (≤24h object)
- `POST /api/media/catalog/uploads/complete` — mark ready, count ingest hours
- `GET /api/media/catalog/usage` — org bytes + hours retained
- `POST /api/media/catalog/objects/:id/tier` — mark hot/warm/cold

## Quotas

Soft per-org ceilings (`org_media_quotas` / `MEDIA_DEFAULT_*`):

- max hot bytes / total bytes
- max ingest seconds per UTC day
- max bytes per object

These protect spend; they do not invent cluster size. Fleet economics are object-storage pricing + retention policy.

## What this is not (yet)

- A claim that production already holds billions of hours
- Automatic purge workers (evidence policy still prefers human action)
- Full cut-over of every `job_proofs.storage_path` row onto `media_objects`

Those land as drivers and migrations harden; the contract above is what clients integrate against now.
