# Atmosphere Field Capture — App Store (iOS)

Native iPhone client: **one button to film the day (video + microphone)**, plus
**on-device measurement** for a **property digital twin**.

Branch focus: `cursor/field-capture-app-build-out-2764` (“Field Capture App Build out”).

The web `fieldcapture/` app is production with **dashboard email/password**
(same as the office console) or `?token=` (job-share link). This Swift app is
what ships on the App Store with RoomPlan + the same audiovisual day film
contract.

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

The Xcode project is in the repo. You do not need `xcodegen`.

**Use this branch for a connected iPhone** — it keeps the project building on
iOS 16 (main’s `onChange` can fail in current Xcode):

```bash
cd /path/to/Atmosphere
git fetch origin
git checkout cursor/host-main-on-phone-5bee
open apps/field-ios/AtmosphereFieldCapture.xcodeproj
```

**Simulator:** no Apple Team needed. Signing is off for `iphonesimulator`.
Pick any iPhone simulator and press Run (⌘R).

**Physical iPhone (cable, for testing):**

1. Unlock the iPhone, plug it into the Mac, and tap **Trust This Computer**.
   Unlock again if the phone asks for the passcode.
2. On the iPhone: **Settings → Privacy & Security → Developer Mode → On**.
   Restart the phone if iOS asks, then confirm.
3. In Xcode: **Xcode → Settings → Accounts** → add your Apple ID (free is
   enough). That creates a Personal Team.
4. Left sidebar → blue **AtmosphereFieldCapture** project → target
   **AtmosphereFieldCapture** → **Signing & Capabilities**.
   Check **Automatically manage signing**. Team = your Personal Team.
   If the bundle id `com.atmosphere.fieldcapture` is taken on that team,
   change it to something unique like `com.yourname.fieldcapture`.
5. Toolbar destination (the device menu next to the Play button) → your
   iPhone, not a simulator.
6. **Product → Clean Build Folder**, then press Run (⌘R). Keep the phone
   unlocked while it installs.
7. First install: iPhone **Settings → General → VPN & Device Management**
   (or **Device Management**) → your Apple ID → **Trust**. Open **Field
   Capture** from the home screen.

A Personal Team build expires after 7 days — Run from Xcode again to refresh.
The phone signs in with the same email/password as the Atmosphere website.
A physical iPhone never uses localhost; it talks to the hosted Atmosphere
project. RoomPlan needs a LiDAR iPhone.

To use the **web** Field Capture on the phone instead (no Xcode):

```bash
bash scripts/host-phone.sh
```

Open the printed `/fieldcapture/` URL in Safari, then Share → Add to Home Screen.

**Sign in with your website account** on first install (same email/password as
the Atmosphere dashboard). Tokens stay in Keychain — later launches skip
connect and open Today. Day films file into `job_proofs` for that org.
Disconnect only from Account → Disconnect.

**Requirements:** iOS 16+, camera + mic + location when-in-use. RoomPlan
twin capture additionally needs a LiDAR iPhone.

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
4. Hold **Finish the day** — proof upload into that job → optional RoomPlan twin.

AI dictation and twin review stay in the **office Verifier**.

## API (account-linked)

On a physical iPhone the app talks to the Atmosphere Supabase project
(same users and jobs as the website). A local BFF is optional in Simulator.

1. Sign-in: `POST /auth/v1/token?grant_type=password` (or BFF `POST /api/auth/login`)
2. Profile + today’s jobs: `my_org_membership` + `crm_jobs` / `job_proofs` (or BFF `/api/field-app/*`)
3. Day film: upload into the `job-proofs` bucket, then insert `job_proofs`
4. Optional RoomPlan twin still uses the BFF geometry routes when one is running

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
