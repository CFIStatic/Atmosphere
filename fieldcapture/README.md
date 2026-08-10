# Atmosphere Field Capture

Production crew app: **one button**, **video + microphone**, filed through a
**job share token**. Not a vibe demo — without `?token=` it refuses to invent a day.

## Run live

Org teammates can open **Field → Film a job** in the dashboard, search this
company’s open jobs (even if they were not invited), and launch a live capture link.

Serve this folder next to the API (same origin or pass `?api=`):

```
/fieldcapture/index.html?token=<job-share-token>&api=http://localhost:4000
```

The API returns an absolute `uploadUrl` for Storage, so you do **not** need
`?storage=` for uploads on localhost. Optional:

| Query | Meaning |
|---|---|
| `token` | Job share access token (required for live) |
| `api` | API origin if not same-host (e.g. `http://localhost:4000`) |
| `storage` | Legacy fallback Storage origin if `uploadUrl` is absent |
| `demo=1` | Explicit scripted demo only — does **not** upload |

## What live mode does

1. `GET /api/job-share/:token` — hydrate today’s job
2. `getUserMedia({ video, audio: true })` + `MediaRecorder` (mic required)
3. Hold to finish → `readCapture` (hash / duration / GPS / frames)
4. `POST …/proof/upload-url` → `PUT` bytes to storage → `POST …/proof`
5. Door screen shows **real** checks / problems from the API

AI dictation stays in the **Verifier**. Twin / RoomPlan stays in the **App Store**
build and office `verifier/twin.html` — not marketing copy on the crew home.

## Files

| Path | Role |
|---|---|
| `index.html` | Shell + styles |
| `js/capture-core.js` | Hash, frames, geolocation, recorder, upload |
| `js/app.js` | Live / demo / blocked modes |

## Native

See `apps/field-ios/` for the App Store Swift client (same A/V + upload contract).
