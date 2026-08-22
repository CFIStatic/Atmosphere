# Legal hold, video vault, and user monitor

Atmosphere keeps field video as evidence. A subpoena, a lawsuit, or a
preservation letter must still be answerable after a customer deletes a clip
from their library.

Install:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260822180000_legal_hold_and_user_monitor.sql
```

Idempotent with the rest of the tree. Apply once — the file is mirrored under
`backend/supabase/migrations/`.

## What it does

1. **Vault.** Every accepted proof and catalog video is written to
   `legal_video_vault` with the object-storage key and hash. User delete stamps
   `user_deleted_at`. It does not remove the row or the bytes.
2. **Soft-delete.** `DELETE /api/media/catalog/objects/:id` and
   `DELETE /api/operations/shared/:jobId/evidence/:proofId` hide the clip from
   the product. RLS and the evidence views omit `deleted_at is not null`. The
   unique (party, day, phase) rule applies only to the visible row, so a refilm
   is a new vault entry.
3. **Platform holds.** Staff open a hold (`subpoena`, `lawsuit`,
   `preservation`, `investigation`, `other`) against an org, a user, a job, or a
   specific video. Matching catalog rows get `legal_hold = true`. A hold cannot
   be deleted; it can only be released with a reason.
4. **User monitor.** Every signed-in `/api` action becomes a row in
   `user_activity_events`. Heartbeats and health probes are skipped. Secrets are
   redacted with the same key-name rules as the agent audit ledger.
5. **Production.** `POST /api/legal/holds/:id/produce` returns vaulted videos
   (including customer-deleted) with short-lived signed URLs, plus the activity
   trail for the hold's subjects.

## Who can read it

Customers cannot. The legal tables enable RLS and grant nothing to `anon` or
`authenticated`. Staff reach them through `/api/legal/*` with the same internal
analytics scope as the accounts file (`requireAuth` +
`requireAnalytics('internal')`). The BFF uses the service role.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/legal/holds` | List holds |
| POST | `/api/legal/holds` | Open a hold |
| GET | `/api/legal/holds/:id` | One hold |
| POST | `/api/legal/holds/:id/release` | Release with a reason |
| POST | `/api/legal/holds/:id/produce` | Videos + activity for counsel |
| GET | `/api/legal/videos/:vaultId/url` | Signed read of a vaulted clip |
| GET | `/api/legal/activity` | User-action monitor |
| GET | `/api/legal/users/:userId` | One person's trail |
| GET | `/api/legal/orgs/:orgId` | One tenant's trail |

A hold body:

```json
{
  "caseNumber": "SDNY-2026-0412",
  "kind": "subpoena",
  "title": "Video of 14 Aug drywall day",
  "reason": "Subpoena duces tecum — produce all field video for the job.",
  "counselName": "Outside counsel",
  "subjects": [
    { "subjectType": "org", "subjectId": "…" },
    { "subjectType": "job", "subjectId": "…" }
  ]
}
```

## What not to put in the monitor

The writer redacts keys matching `pass|secret|token|credential|authorization|
api_key|pin|ssn|cvv|card_number|private_key` and strips `data:` URLs. Do not
rely on that as the only line: do not send passwords or session tokens in
bodies the monitor might copy.

## Tests

```bash
LEGAL_STORE=memory MEDIA_STORE=memory npm test -- --test-name-pattern legal
```
