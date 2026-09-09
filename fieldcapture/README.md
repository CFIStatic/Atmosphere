# Atmosphere Field Capture

Production crew app: **one button**, **video + microphone**, filed with the
**same Atmosphere login as the dashboard** — or through a **job share token**.

## Sign in

Open Field Capture and sign in with the **same email and password** as the
office Platform. Today’s jobs load from that office account; the day film
files into that org’s evidence library.

Live web host: `https://app.atmosphereteam.com/`
(Railway: `https://field-capture-production.up.railway.app/`;
office fallback: `/fieldcapture/` on `https://platform.atmosphereteam.com`).

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

Sign in with your Platform email and password, or open a job share link.

The API returns an absolute `uploadUrl` for Storage, so you do **not** need
`?storage=` for uploads on localhost. Optional:

| Query | Meaning |
|---|---|
| *(none)* | Same email + password as the office Platform |
| `token` | Job share access token (no office login) |
| `api` | API origin if not same-host (e.g. `http://localhost:4000`) |
| `storage` | Legacy fallback Storage origin if `uploadUrl` is absent |
| `demo=1` | Explicit scripted demo only — does **not** upload |

## What live mode does

1. Sign in (`POST /api/auth/login`) **or** open `?token=`
2. Load today’s jobs (`GET /api/field-app/today`) or the shared job
3. `getUserMedia({ video, audio: true })` + live `<video>` preview + `MediaRecorder` (mic required; iPhone needs playsinline + play())
4. Hold the screen awake with a **Screen Wake Lock** and chunk footage every second so a job keeps filming until the crew ends it — see “Recording that survives the day” below
5. Hold 5 seconds to finish → `readCapture` (hash / duration / GPS / frames)
6. `POST …/proof/upload-url` → `PUT` bytes to storage → `POST …/proof`
7. Door screen shows **real** checks / problems from the API

AI dictation stays in the **Verifier**. Twin / RoomPlan stays in the **App Store**
build and office `verifier/twin.html` — not marketing copy on the crew home.

## Recording that survives the day

A day film should not die because the phone dimmed, auto-locked, or went in a
pocket. Recording runs until the crew ends it with the **hold-to-finish off
button** — never on its own:

- **Screen Wake Lock.** For the whole take we hold `navigator.wakeLock` so the
  phone does not auto-lock and suspend the camera. Re-acquired the moment the
  app returns to the foreground (locks drop when a page hides). Best-effort:
  where the browser lacks it, recording still works, just without the keep-awake.
- **Nothing filmed is lost.** `MediaRecorder` flushes a chunk every second, and
  a lock/background triggers an immediate `requestData()`, so everything shot up
  to that instant is kept and filed when the day finishes.
- **Overt, never covert.** The live preview stays on screen and a status line
  reads *“Recording — keep the screen on”*, switching to an amber
  *“Recording paused — reopen Field Capture”* if a lock pauses the camera.

### Platform limits worth stating plainly

- **Powered off: not possible on any phone.** When a device is off its OS is
  not running, so no app or web page executes and the camera/mic are unpowered.
  There is no software path to filming while the phone is off.
- **Locked / backgrounded: the OS stops the camera.** iOS Safari mutes capture
  and Android Chrome freezes the page once the app is not in the foreground;
  there is no web API to keep the camera rolling through a lock. The wake lock’s
  job is to stop the phone from locking in the first place. (The `apps/field-ios/`
  App Store build hits the same wall — iOS forbids background video capture.)

## Files

| Path | Role |
|---|---|
| `index.html` | Shell + styles |
| `js/capture-core.js` | Hash, frames, geolocation, recorder, upload |
| `js/app.js` | Sign-in / live / demo modes |

## Native

See `apps/field-ios/` for the App Store Swift client (same A/V + upload contract).
