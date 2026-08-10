# Atmosphere Field Capture — App Store (iOS)

Native iPhone client: **one button to film the day (video + microphone)**, plus
**on-device measurement** for a **property digital twin**.

Branch focus: `cursor/field-capture-app-build-out-2764` (“Field Capture App Build out”).

The web `fieldcapture/` app is production with `?token=` (live MediaRecorder →
job-share proof upload). This Swift app is what ships on the App Store with
RoomPlan + the same audiovisual day film contract.

## Audiovisual day film (required)

| Track | Role |
|---|---|
| **Video** | What the crew walked and worked |
| **Audio (microphone)** | What was said / site sound — stored in the same MP4 |

The server extracts stills for AI dictation **without dropping** the soundtrack
from the stored object. Catalog field `has_audio` must be `true` for
`field_day_video` / `proof_video` (`capturePolicy.ts`). Upload with
`hasAudio: false` is rejected.

Swift: `DayFilmRecorder` always adds an `AVCaptureDevice` audio input and
**refuses to finish** if the file has no audio track.

## Open in Xcode

```bash
brew install xcodegen   # once
cd apps/field-ios
xcodegen generate
open AtmosphereFieldCapture.xcodeproj
```

**If Build Failed:** almost always Signing. In Xcode → target **AtmosphereFieldCapture**
→ **Signing & Capabilities** → check **Automatically manage signing** → pick your
**Team** (Apple ID). Then Product → Clean Build Folder → Run.

Also set `ATMOSPHERE_API_BASE` to your API (same host as the dashboard), then run
on a LiDAR iPhone for RoomPlan.

**Sign in with your website account** on first install (same email/password as
the Atmosphere dashboard). Under **Server**, point at the same API host the
website uses (simulator default: `http://127.0.0.1:4000`). Tokens stay in
Keychain — later launches skip connect and open Today. Day films file into
`job_proofs` for that org. Disconnect only from Account → Disconnect.

**Requirements:** iOS 17+, camera + mic + location when-in-use.

## Source layout

```
AtmosphereFieldCapture/
  AtmosphereFieldCaptureApp.swift   # entry
  Capture/DayFilmRecorder.swift     # AVFoundation A/V MP4
  Capture/CapturePermissions.swift
  Location/SiteLocator.swift
  Geometry/RoomPlanBridge.swift     # RoomPlan hook → twin ingest
  Network/AtmosphereClient.swift    # /api/media/catalog + /api/geometry
  Network/MediaUploadClient.swift   # signed PUT / multipart
  Session/FieldDaySession.swift     # today → record → door → upload
  UI/TodayView.swift · RecordingView.swift · DoorView.swift
  Theme/FieldTheme.swift
  Info.plist
```

## Crew flow

1. **First launch only:** Connect Atmosphere account (same as dashboard).
2. Later launches open Today already connected.
3. Confirm today’s jobs (tap one if several) → **Start the day**.
   Or **search** by address / job # / title when something comes up that you
   were not assigned to — any open org job can receive a day film.
4. Hold **Finish the day** — proof upload into that job → optional RoomPlan twin.

AI dictation and twin review stay in the **office Verifier**.

## API (account-linked)

1. `POST /api/auth/login` → `{ user, session: { accessToken, refreshToken } }`
2. `GET /api/field-app/me` + `GET /api/field-app/today` (Bearer)
3. `GET /api/field-app/jobs/search?q=` — find any open org job (assigned or not)
4. `POST /api/field-app/jobs/:jobId/proof/upload-url` → signed PUT URL
5. PUT video bytes → `POST /api/field-app/jobs/:jobId/proof` (creates `job_proofs`)
6. Optional: `POST /api/geometry/sessions` + `…/ingest` for RoomPlan
7. Web: `POST /api/field-app/jobs/:jobId/capture-link` → `/fieldcapture/…?token=`

See also `docs/media-storage.md` and `backend/src/geometry/`.

## Product boundary

| On phone | In office |
|---|---|
| Film (video + audio) + measure | Watch / listen + AI dictation |
| Upload MP4 + rooms / USDZ | Inspect digital twin |
| Door checks | Scope verdicts, estimating |

## Brand

Home-screen / App Store icon is the Atmosphere **five bars** mark
(`Assets.xcassets/AppIcon.appiconset`) — same bars as the web logo, orange base.
In-app header uses `AtmosphereBarsMark`.

## Still to wire in Xcode

- UIKit host for `RoomCaptureViewController` → real room list + USDZ
- Background `URLSession` for multi‑GB day uploads on poor signal
- App Store Connect listing, TestFlight, privacy nutrition labels
