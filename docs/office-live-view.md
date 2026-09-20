# Office Live view (low-latency Field Capture)

Let the office watch what a crew is filming **while** Field Capture is still
recording — targeting **≤1–2 seconds** end-to-end lag under normal conditions.

## Architecture

| Piece | Behavior |
| --- | --- |
| **FC durable streamer** | `MediaRecorder` timeslice **1s** → `createDayFilmStreamer` groups ~**4 MB** parts → PUT to signed `storage_path.parts/NNNN` while the camera rolls. Offline: streamer stops; the day-film queue keeps the full blob and files later. **Unchanged** for historical / Resume / ASAP-when-online filing. |
| **FC WebRTC publisher** | Same camera `MediaStream` published via `createLiveRtcPublisher` → BFF signaling at `/api/live/signal`. Failures never stop recording or part uploads. |
| **Part mint** | `POST …/proof/upload-part-url` upserts `proof_live_sessions` (org/job/clip). |
| **Finalize** | Hold-to-finish → queue sends the tail → `upload-complete` stitches parts → `POST …/proof` files the row and **ends** the live session. No duplicate film: one clip id / storage path. |
| **Office API** | `GET /api/operations/shared/:jobId/live` and `…/live/:clipId` (org members via `requireOrgContext` — **not** homeowners / progress grants). Lists contiguous landed parts, mints signed read URLs, and advertises `signalPath` + `iceServers`. |
| **Player** | Platform job file **Live** panel (`OfficeLiveView`). Prefers **WebRTC**; falls back to part Blob playback if the peer path fails. Session list polls ~**2s**. Stale/offline sessions drop off Live. |

## Latency expectations

| Path | Typical end-to-end lag |
| --- | --- |
| **WebRTC (primary)** | **≤1–2 s** behind the camera (encode + ICE + network). Needs STUN; **TURN** (`LIVE_TURN_*`) for restrictive NATs. |
| **Parts fallback** | Fill one ~4 MB part at ~2 Mbps ≈ **~16 s** + upload + poll (≤2 s) ≈ **15–35 s** |

Documented string: `LIVE_VIEW_LATENCY_NOTE` in `backend/src/live/officeLiveView.ts`.

## How the office opens Live

1. Open the **job file** (Platform / Dashboard → job).
2. While a crew is recording **online**, a green **Live** card appears under the pulse tiles.
3. Click **Watch now** (or wait for auto-connect). A **≤2s** badge means WebRTC is up; **segments** means the parts fallback.
4. When recording ends and the film is filed, the Live card disappears; use the normal proof player (with privacy redaction once analysis finishes).

## Privacy / unredacted disclosure

- **Live may show unredacted (raw) footage** until the day film is filed and
  analysis writes child-blur / private-moment ranges. Office operators should
  treat Live as a near-realtime operational feed, not a privacy-safe playback
  surface. The Live card states this in-product (`LIVE_PRIVACY_NOTE`).
- After file + analysis, use the filed `JobFilePlayer` which applies stored
  ranges. See `docs/privacy-redaction.md` and `docs/child-privacy-redaction.md`.

## Auth

- Office / org members only for watching (`requireOrgContext` + signal hub viewer role).
- Field Capture publishes with the same field-app JWT or job-share token used for part uploads.
- Homeowners / invitees / progress grants never receive Live.

## Env (production)

| Variable | Purpose |
| --- | --- |
| `LIVE_TURN_URLS` | Comma-separated TURN URLs (e.g. `turn:turn.example.com:3478`) |
| `LIVE_TURN_USERNAME` | TURN username |
| `LIVE_TURN_CREDENTIAL` | TURN credential |

STUN (`stun.l.google.com`) is always included. Without TURN, some mobile↔office
pairs will fall back to the parts player (~15–35s).

## Tests

- `backend/test/officeLiveView.test.ts` — contiguous parts, freshness, presenters, latency copy
- `backend/test/liveSignalHub.test.ts` — ICE helpers / room key behaviour
- FC `hold-to-finish.test.mjs` — streamer part size + live publisher export
- `frontend/src/components/shared/OfficeLiveView.test.tsx`
- `frontend/src/demo/liveFirst.test.ts` — live API paths hit the real backend in demo mode

## Related

- Stream-while-recording: `fieldcapture/js/capture-core.js` (`createDayFilmStreamer`, `createLiveRtcPublisher`)
- Signaling: `backend/src/live/liveSignalHub.ts`
- Safety near-realtime samples (~25s): `docs/safety-alerts.md`
