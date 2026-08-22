# Atmosphere Field Capture

Production crew app: **one button**, **video + microphone**, filed with the
**same Atmosphere login as the dashboard** — or through a **job share token**.

## Sign in

Open Field Capture and sign in with the **same email and password** you use on
the office dashboard. Today’s jobs load from your office account; the day film
files into that org’s evidence library.

A job share link (`?token=`) still works without signing in — that path is for
subs who were invited to one job.

## Test as an app against the hosted office

The live Field Capture app is already on the office host. Open it on the phone
in Safari (iPhone) or Chrome (Android):

```text
https://atmosphere-web-production.up.railway.app/fieldcapture/
```

Then **Add to Home Screen** / **Install app**. Same-origin `/api` is the hosted
BFF — you do not pass `?api=`. A chip on the screen confirms
`Connected to atmosphere-web-production.up.railway.app`. A leftover
`?api=http://localhost:4000` is ignored on that host so the phone cannot
silently miss the live office.

Crew connect with **name + office invite code** (Atmosphere → Settings). A job
share link (`?token=`) still works without connecting.

## Run a local copy

On a phone, use HTTPS (Safari will not give the camera on `http://`):

```bash
bash scripts/host-phone.sh
```

Open the printed `/fieldcapture/` URL, then Share → **Add to Home Screen**.

Serve this folder next to the API (same origin or pass `?api=` only on
localhost):

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
| `js/host.js` | Hosted API origin + home-screen install helpers |
| `js/capture-core.js` | Hash, frames, geolocation, recorder, upload |
| `js/app.js` | Connect / live / demo modes |
| `sw.js` | Service worker so Chrome can install it as an app |
| `manifest.webmanifest` | Standalone home-screen app |

## Native

See `apps/field-ios/` for the App Store Swift client (same A/V + upload contract).
