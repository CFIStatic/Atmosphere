# Atmosphere Field Capture

Production crew app: **one button**, **video + microphone**, filed with the
**same Atmosphere login as the dashboard**.

## Sign in

Open Field Capture and sign in with the **same email and password** you use on
the office dashboard. Each person uses their own login. Today’s jobs load from
that account; the day film files into that org’s evidence library.

Job invites (`?token=` or a pasted `/shared/…` link) are accepted **after
sign-in**. They add that job to this login’s Today. Invites are not a
substitute for an account.

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

Sign in first. If the URL has a token, Field Capture holds it and opens
**Accept a job** once this login is connected.

The API returns an absolute `uploadUrl` for Storage, so you do **not** need
`?storage=` for uploads on localhost. Optional:

| Query | Meaning |
|---|---|
| *(none)* | Sign in with dashboard email + password |
| `token` | Job invite held until this login accepts it |
| `api` | API origin if not same-host (e.g. `http://localhost:4000`) |
| `storage` | Legacy fallback Storage origin if `uploadUrl` is absent |
| `demo=1` | Explicit scripted demo only — does **not** upload |

## What live mode does

1. Sign in (`POST /api/auth/login`) with this person’s dashboard account
2. Optionally accept a job invite (`POST /api/field-app/invites/accept`)
3. Load today’s jobs (`GET /api/field-app/today`)
4. `getUserMedia({ video, audio: true })` + `MediaRecorder` (mic required)
5. Location watches while the day film rolls
6. Hold to finish → save the film on this phone (IndexedDB) → file when online
7. Door shows saved / filed checks. There is no Sending page.

Building measurements (RoomPlan) stay on the **iPhone Field Capture** app and
are a short walk when a job has none. They do not run in the background here.

AI dictation stays in the **Verifier**.

## Files

| Path | Role |
|---|---|
| `index.html` | Shell + styles |
| `js/capture-core.js` | Hash, frames, geolocation, recorder, offline queue, upload |
| `js/app.js` | Sign-in, invites, live / demo modes |

## Native

See `apps/field-ios/` for the App Store Swift client (same A/V + upload
contract, plus the measure walk on a LiDAR iPhone).
