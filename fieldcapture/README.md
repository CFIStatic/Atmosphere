# Atmosphere Field Capture

Production crew app: **one button**, **video + microphone**, filed with the
**same Atmosphere login as the dashboard** — or through a **job share token**.

## Dedicated host

Railway service **`Field Capture`** serves only this folder — no office login,
no dashboard. Same BFF via `/api`.

| URL on that host | What it is |
| --- | --- |
| `/` | Phone app |
| `/fieldcapture/` | Same app (office invite path) |
| `/healthz` | nginx liveness |

Office `https://atmosphere-web-production.up.railway.app/fieldcapture/` stays
as a fallback until copy-links switch to `FIELD_CAPTURE_ORIGIN`.

Local stand-in: `docker compose up --build` → http://localhost:8082

```bash
docker build -f fieldcapture/Dockerfile -t atmosphere-field .
docker run --rm -p 8082:80 -e API_UPSTREAM=http://host.docker.internal:4000 atmosphere-field
```

## Sign in

Open Field Capture and sign in with the **same email and password** you use on
the office dashboard. Today’s jobs load from your office account; the day film
files into that org’s evidence library.

A job share link (`?token=`) still works without signing in — that path is for
subs who were invited to one job.

## Run live

On a phone, use HTTPS (Safari will not give the camera on `http://`):

```bash
bash scripts/host-phone.sh
```

Open the printed `/fieldcapture/` URL, then Share → **Add to Home Screen**.

Serve this folder next to the API (same origin or pass `?api=`):

```
/fieldcapture/index.html
/fieldcapture/index.html?token=<job-share-token>&api=http://localhost:4000
```

Sign in with your dashboard email and password, or open a job share link.

The API returns an absolute `uploadUrl` for Storage, so you do **not** need
`?storage=` for uploads on localhost. Optional:

| Query | Meaning |
|---|---|
| *(none)* | Sign in with dashboard email + password |
| `token` | Job share access token (no office login) |
| `api` | API origin if not same-host (e.g. `http://localhost:4000`) |
| `storage` | Legacy fallback Storage origin if `uploadUrl` is absent |
| `demo=1` | Explicit scripted demo only — does **not** upload |

## What live mode does

1. Sign in (`POST /api/auth/login`) **or** open `?token=`
2. Load today’s jobs (`GET /api/field-app/today`) or the shared job
3. `getUserMedia({ video, audio: true })` + `MediaRecorder` (mic required)
4. Hold to finish → `readCapture` (hash / duration / GPS / frames)
5. `POST …/proof/upload-url` → `PUT` bytes to storage → `POST …/proof`
6. Door screen shows **real** checks / problems from the API

AI dictation stays in the **Verifier**. Twin / RoomPlan stays in the **App Store**
build and office `verifier/twin.html` — not marketing copy on the crew home.

## Files

| Path | Role |
|---|---|
| `index.html` | Shell + styles |
| `js/capture-core.js` | Hash, frames, geolocation, recorder, upload |
| `js/app.js` | Sign-in / live / demo modes |

## Native

See `apps/field-ios/` for the App Store Swift client (same A/V + upload contract).
