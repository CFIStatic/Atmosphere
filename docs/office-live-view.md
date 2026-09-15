# Office Live view (near-realtime Field Capture)

Let the office watch what a crew is filming **while** Field Capture is still
recording — without building a WebRTC SFU.

## Architecture (MVP)

| Piece | Behavior |
| --- | --- |
| **FC streamer** | `MediaRecorder` timeslice **1s** → `createDayFilmStreamer` groups ~**4 MB** parts → PUT to signed `storage_path.parts/NNNN` while the camera rolls. Offline: streamer stops; the day-film queue keeps the full blob and files later. |
| **Part mint** | `POST …/proof/upload-part-url` upserts `proof_live_sessions` (org/job/clip). |
| **Finalize** | Hold-to-finish → queue sends the tail → `upload-complete` stitches parts → `POST …/proof` files the row and **ends** the live session. No duplicate film: one clip id / storage path. |
| **Office API** | `GET /api/operations/shared/:jobId/live` and `…/live/:clipId` (org members via `requireOrgContext` — **not** homeowners / progress grants). Lists contiguous landed parts and mints signed read URLs. |
| **Player** | Platform job file shows a **Live** / **Watch now** panel (`OfficeLiveView`). Polls every **5s**, concatenates part bytes into a Blob for `<video>`. |

True WebRTC / SFU is **not** wired (same TODO family as safety live analysis).

## Latency expectations

| Stage | Typical |
| --- | --- |
| Fill one ~4 MB part at ~2 Mbps | ~16 s of camera time |
| Upload + mint | a few seconds on decent signal |
| Office poll | ≤ 5 s |
| **End-to-end lag** | **~15–35 s** behind the camera |

Documented string: see `LIVE_VIEW_LATENCY_NOTE` in `backend/src/live/officeLiveView.ts`.

## How the office opens Live

1. Open the **job file** (Platform / Dashboard → job).
2. While a crew is recording **online**, a green **Live** card appears under the pulse tiles.
3. Click **Watch now** (or wait for auto-load) to play the latest contiguous segments.
4. When recording ends and the film is filed, the Live card disappears; use the normal proof player (with privacy redaction once analysis finishes).

## Privacy / unredacted disclosure

- **Live may show unredacted (raw) footage** until the day film is filed and
  analysis writes child-blur / private-moment ranges. Office operators should
  treat Live as a near-realtime operational feed, not a privacy-safe playback
  surface. The Live card states this in-product (`LIVE_PRIVACY_NOTE`).
- After file + analysis, use the filed `JobFilePlayer` which applies stored
  ranges. See `docs/privacy-redaction.md` and `docs/child-privacy-redaction.md`.

## Auth

- Office / org members only (`requireOrgContext`).
- Field Capture continues to use existing field-app / job-share upload auth.

## Tests

- `backend/test/officeLiveView.test.ts` — contiguous parts, freshness, presenters
- FC `hold-to-finish.test.mjs` — streamer part size
- `frontend/src/demo/liveFirst.test.ts` — live API paths hit the real backend in demo mode

## Related

- Stream-while-recording: `fieldcapture/js/capture-core.js` (`createDayFilmStreamer`)
- Safety near-realtime samples (~25s): `docs/safety-alerts.md`
