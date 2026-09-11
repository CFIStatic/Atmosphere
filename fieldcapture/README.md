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
3. `getUserMedia` (~720p / ~30fps) + live `<video>` preview + `MediaRecorder` (~2 Mbps, mic required; iPhone needs playsinline + play())
4. While the camera rolls, the film **streams to the office in parts**
   (`POST …/proof/upload-part-url` → `PUT` each ~8 MB slice as it fills)
5. Hold 5 seconds to finish → the film is **saved on the phone** (IndexedDB)
   and the door reads **Done** — tap **Record another** to open the camera
   again at once, or go Home and pick another job, even with no signal
6. The filing queue sends the tail in the background, then
   `POST …/proof/upload-complete` stitches the parts and `POST …/proof`
   files the day (`readCapture` — hash / duration / GPS / frames — runs
   alongside). A film that could not stream uploads whole:
   `POST …/proof/upload-url` → `PUT` → `POST …/proof`
7. While the door is open its filing line updates live; once the office has
   the film the door shows the **real** checks / problems from the API

## Stop one video, start the next

Every recording gets its own clip id and its own storage object
(`…/<workDate>-after-<clipId>.webm`), so a second film on the same job the
same day is a second film in the library, not a replacement. The door offers
**Record another** (same job, one tap) next to **Back to Home Screen**.

## Fast uploads: send while filming

`createDayFilmStreamer` groups MediaRecorder chunks into ~8 MB parts and
PUTs each one to its own signed URL while recording continues — one part at
a time, strictly in order, so the landed prefix is always contiguous. By
hold-to-finish most of the film is already in storage; the queue sends only
the tail (two parts at a time), then asks the office to stitch. Streaming
needs an office job id (not a phone-only draft) or a job-share link, and
signal at the start of the recording. It is a head start, never the record
of truth: if a part will not land, or the film would exceed what the office
stitches (512 MB / 128 parts), streaming simply stops and the queue sends
everything from `bytesDone` on. If the office refuses to stitch, the queue
sends the whole film instead, straight away.

## Filing in the background

Finishing a day never waits on the upload.

- **Saved first.** `recordDayFilm().stop()` hands the blob to
  `createDayFilmQueue`, which writes it to IndexedDB (`atm.field.dayFilms`,
  bytes and metadata in separate stores). A killed tab, a reload, or a dead
  battery does not lose the day. If the phone refuses IndexedDB the film
  stays in memory and Today says to keep Field Capture open.
- **One at a time, oldest first.** Sequential uploads give each film the
  whole connection, so each lands fast when signal is there.
- **Waits, never fails.** `navigator.onLine === false` marks films
  *Waiting for signal* without burning an attempt. A failed attempt retries
  on its own: 5s, 10s, 20s, 40s, then every minute, forever. The `online`
  event, the app returning to the front (`visibilitychange` / `pageshow`),
  and a 15-second safety tick all skip the backoff.
- **Stamped when filmed.** `workDate`, `recordedAt` (→ `capturedAt`) and
  the GPS fix from the recording travel with the film; a film sent hours
  later is filed under the day and place it was shot. Hash, stills and
  duration are read once and kept for retries.
- **Outlives the token.** A 401 mid-queue refreshes the session
  (`POST /api/auth/refresh`) and retries. If the refresh token is dead too,
  the sign-in screen says how many days are saved on this phone; they finish
  after the next sign-in by the same crew.
- **Phone-only jobs.** A day filmed on a job named offline carries a copy of
  the draft. Once the office creates the job the film follows the office id;
  if the draft list was cleared, the film recreates the job itself.
- **Today strip.** `#filing` stays quiet during normal background Uploading…
  (the office Overview owns pending-with-the-office). It only appears when
  the crew must act — sign-in needed, a stuck server answer, or a volatile
  copy that requires keeping Field Capture open. Jobs still show *Filmed
  today* the moment the recorder stops.

Older phones without a clip id still use the one-object-per-day path, where
a re-upload replaces the day's film; the office accepts both.

AI dictation stays in the **Verifier**. Twin / RoomPlan stays in the **App Store**
build — not marketing copy on the crew home.

## Files

| Path | Role |
|---|---|
| `index.html` | Shell + styles |
| `js/capture-core.js` | Hash, frames, geolocation, recorder, upload |
| `js/app.js` | Sign-in / live / demo modes |

## Native

See `apps/field-ios/` for the App Store Swift client (same A/V + upload contract).
