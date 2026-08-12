# Atmosphere Field Capture

Production crew app: **one button**, **video + microphone**, filed through a
**job share token**. Not a vibe demo — without `?token=` it refuses to invent a day.

## Run live

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

## Offline — built for rural sites

Crews film where there is often no signal at all, so the app is offline-first
end to end:

- **The app opens with no internet.** `sw.js` keeps the shell (page + scripts)
  on the device after the first visit; the job and the week's filed days are
  cached on-device too, so the home screen still shows the real job offline.
- **A finished day is saved before any network is tried.** The recording goes
  into IndexedDB with its facts — SHA-256, GPS, frames, duration — and its
  **work date fixed at capture time**, so a Tuesday filmed offline files as
  Tuesday no matter when signal returns.
- **Upload happens by itself.** The queue drains on app open, on the
  browser's back-online event, and on a 2-minute retry tick; an entry is
  deleted only after the office confirms the filing. The home screen shows a
  badge while days wait on the phone.

## Real data only

Everything live mode displays comes from the job file, never a placeholder:
the header identity is the linked party's `contact_name` + `company` from the
share, "what today expects" is the shared job itself, and "this week" is the
party's actual filed days (acceptance and open problems included) from
`GET /api/job-share/:token/proof`. The scripted `?demo=1` mode labels itself
"Demo crew / Sample data" so it can never be mistaken for a real account.
