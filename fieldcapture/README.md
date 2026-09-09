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
4. Hold 5 seconds to finish → the film is **saved on the phone** (IndexedDB)
   and the door reads **Done** — the crew goes Home and can start the next
   day immediately, even with no signal
5. The filing queue sends one film at a time in the background:
   `readCapture` (hash / duration / GPS / frames) →
   `POST …/proof/upload-url` → `PUT` bytes to storage → `POST …/proof`
6. While the door is open its filing line updates live; once the office has
   the film the door shows the **real** checks / problems from the API

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
- **Today strip.** `#filing` shows what is on this phone and what it is doing
  (`Filing 2 days with the office · 43%`, `1 day saved on this phone ·
  Waiting for signal`) and disappears when the office has everything. Jobs
  show *Filmed today* the moment the recorder stops.

The office keeps one day film per job, per day, per crew member: a second
film of the same job on the same day replaces the first when it lands
(`job_proofs_one_per_phase`). The queue sends both in order.

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
