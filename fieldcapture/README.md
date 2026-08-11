# Atmosphere Field Capture

Production crew app: **one button**, **video + microphone**, filed through a
**job share token**. Not a vibe demo — without `?token=` it refuses to invent a day.

## Run live

With the frontend Vite app (`npm run dev` in `frontend/`, port **5174**), open:

```
http://localhost:5174/fieldcapture/index.html?demo=1
```

That loads the crew UI without a job token (scripted demo — no upload). For a
real day film, serve this folder next to the API (same origin or pass `?api=`):

```
http://localhost:5174/fieldcapture/index.html?token=<job-share-token>
```

Same-origin `/api` is proxied by Vite, so `?api=` is optional on localhost.
Legacy / standalone:

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
