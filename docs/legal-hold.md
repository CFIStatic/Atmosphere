# Legal hold, video vault, and user monitor

Atmosphere keeps field video as evidence. A subpoena, a lawsuit, or a
preservation letter must still be answerable after a customer deletes a clip
from their library.

Install:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260822183000_legal_hold_and_user_monitor.sql
psql "$DATABASE_URL" -f supabase/migrations/20260823120000_automatic_legal_holds.sql
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
6. **Automatic preservation.** Rules in `backend/src/legal/autoHold.ts` read the
   monitor and freeze a job on their own when the activity says the record is
   about to be argued over. Nobody in the customer's office decides this, and
   nobody has to remember to.

## Who can read it

Customers cannot. The legal tables enable RLS and grant nothing to `anon` or
`authenticated`. Staff reach them through `/api/legal/*` with the same internal
analytics scope as the accounts file (`requireAuth` +
`requireAnalytics('internal')`). The BFF uses the service role.

## Automatic preservation

Freezing evidence used to be a button on the customer's own job file — a
job-level panel and a per-clip toggle. Both are gone, and the reason is not
trust. The party most likely to want a clip gone is the party who was standing
in front of the camera, and the moment a hold matters most is the moment nobody
in that office wants to be the one who clicked it. Asking them to freeze the
file for a dispute they are a side in is the wrong question, of the wrong
person, at the wrong moment.

So the switch is inside. The rules read `user_activity_events` — which already
sees every signed-in delete and every outside read of the evidence portal — and
open a `preservation` hold on the job when the shape of the activity fires one:

| Rule | Fires when |
| --- | --- |
| `delete_after_outside_review` | Video deleted after an outside party read this job's evidence |
| `bulk_deletion` | 3+ clips deleted from one job inside 72 hours |
| `sustained_outside_review` | 5+ outside reads of one job inside 14 days |

Two properties are deliberate:

* **A rule only ever freezes.** Nothing here destroys anything, so a false
  positive costs storage and a false negative costs the case.
* **Nothing releases on its own.** `review_by` is a queue for the legal desk,
  not an expiry. An automatic hold nobody looks at stays shut until a person
  releases it with a reason.

Holds carry `origin` (`staff` / `automatic`) and `auto_rule`, so the desk can
always tell which is which. Rules run three ways, all idempotent against each
other: debounced right after a triggering request, hourly from
`startAutoHoldScheduler()`, and on demand from the desk.

`AUTO_HOLD_DEBOUNCE_MS` (default 15s), `AUTO_HOLD_SWEEP_MS` (default 1h), and
`AUTO_HOLD_LIVE=off` tune it.

## What the customer sees

Nothing to click. The evidence locker still shows that a file is frozen and
that it cannot age out of retention, because a customer should know the state
of their own record — but there is no control, in either direction. Deleting a
clip still hides it from their library and still leaves it in the vault.

## Job portal

Staff open `/legal/jobs/:jobId` on the internal site (or
`GET /api/legal/jobs/:jobId`) to see the vault for one job, including the clips
the customer hid, and every hold on it.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| GET | `/api/legal/jobs/:jobId` | Staff | Vault including customer-deleted clips |

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/legal/holds` | List holds |
| POST | `/api/legal/holds` | Open a hold |
| GET | `/api/legal/holds/:id` | One hold |
| POST | `/api/legal/holds/:id/release` | Release with a reason |
| POST | `/api/legal/holds/:id/produce` | Videos + activity for counsel |
| GET | `/api/legal/auto-holds` | Rules, what is firing, what they froze |
| POST | `/api/legal/auto-holds/sweep` | Run the rules (`{"apply": false}` to dry-run) |
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
