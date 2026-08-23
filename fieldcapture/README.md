# Atmosphere Field Capture

Production crew app: **one button**, **video + microphone**, filed against the
**person’s name and company code from the office** — or through a **job share
token**.

## Sign in

Open Field Capture and type your **name** and the **company code** from
Atmosphere → Settings → Organization. We store both on this phone; later
launches open Today already linked. Today’s jobs load from that office; the
day film files into the org’s evidence library.

A job share link (`?token=`) still works without a code — that path is for
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

Enter your name and the company code once, or open a job share link.

The API returns an absolute `uploadUrl` for Storage, so you do **not** need
`?storage=` for uploads on localhost. Optional:

| Query | Meaning |
|---|---|
| *(none)* | Enter your name and the company code once; the phone stays linked |
| `token` | Job share access token (no office login) |
| `api` | API origin if not same-host (e.g. `http://localhost:4000`) |
| `storage` | Legacy fallback Storage origin if `uploadUrl` is absent |
| `demo=1` | Explicit scripted demo only — does **not** upload |

## What live mode does

1. Enter your name and the company code (`POST /api/field-app/join`) **or** open `?token=`
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
