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

Set your Development Team, point `ATMOSPHERE_API_BASE` at your API, sign in
token wiring, then run on a LiDAR iPhone for RoomPlan.

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

1. Tap **Start the day** — recording begins (camera + mic).
2. Work the jobs — GPS + clock ride with the film; no job picker.
3. Hold **Finish the day** — probe A/V tracks → upload catalog → optional RoomPlan → twin session.

AI dictation and twin review stay in the **office Verifier**.

## API (same as backend foundation)

1. `POST /api/media/catalog/uploads` with `hasAudio: true`, `kind: field_day_video`
2. PUT bytes (or multipart) to signed URL
3. `POST /api/media/catalog/uploads/complete` with `hasAudio: true`
4. `POST /api/geometry/sessions` + optional `…/ingest` for RoomPlan rooms

See also `docs/media-storage.md` and `backend/src/geometry/`.

## Product boundary

| On phone | In office |
|---|---|
| Film (video + audio) + measure | Watch / listen + AI dictation |
| Upload MP4 + rooms / USDZ | Inspect digital twin |
| Door checks | Scope verdicts, estimating |

## Still to wire in Xcode

- UIKit host for `RoomCaptureViewController` → real room list + USDZ
- Auth cookie / bearer exchange with Atmosphere login
- Background `URLSession` for multi‑GB day uploads on poor signal
- App Store Connect listing, TestFlight, privacy nutrition labels
