# Atmosphere Field Capture — App Store (iOS)

Native iPhone client: **one button to film the day (video + microphone)**, plus
**on-device measurement** for a **property digital twin**.

Branch focus: `cursor/field-capture-app-build-out-2764` (“Field Capture App Build out”).

The web `fieldcapture/` app is production with **dashboard email/password**
(same as the office console). Job invites are accepted after sign-in. This
Swift app is what ships on the App Store with the same audiovisual day film
contract, plus a short measure walk on a LiDAR iPhone when a job has none.

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

The project on `main` builds on iOS 16 (no iOS 17-only `onChange`):

```bash
cd /path/to/Atmosphere
git checkout main
git pull origin main
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

**Browser host (no Xcode):** the Swift screens are also served as a phone-framed
preview so you can walk Sign in → Today → Record → Door without a simulator.

```bash
bash scripts/host-ios-preview.sh
```

Open `http://localhost:5175/` (cloud-agent preview tab **ios**). The Vite app
also mounts the same folder at `/ios`. This preview does not upload. The live
crew web app is still `fieldcapture/`.

To use the **web** Field Capture on the phone instead (no Xcode):

```bash
bash scripts/host-phone.sh
```

Open the printed `/fieldcapture/` URL in Safari, then Share → Add to Home Screen.

**Create an account or sign in** on first install (same email/password as the
Atmosphere website). Link the phone to the office with the join code from
Atmosphere → Settings → Organization (**Link to office account**), or start a
new office from the phone. A join link `atmosphere-field://join?code=…` opens
that screen. Tokens stay in Keychain — later launches skip connect and open
Today. Day films file into `job_proofs` for that org. Disconnect only from
Account → Disconnect.

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
  UI/TodayView.swift · MyJobsView.swift · AddJobView.swift · FieldChrome.swift
  UI/SignInView.swift · SignUpView.swift · OfficeLinkView.swift
  UI/RecordingView.swift · DoorView.swift
  Theme/FieldTheme.swift
  Info.plist
```

## Crew flow

1. **First launch only:** Create an Atmosphere account or sign in (same as the website), then **Link to office account** with the office join code.
2. Later launches open Today already connected.
3. Confirm today’s assigned jobs (or **Add job**) → **Start the day**. **My jobs** is the filmed record — search by name, address, job number, status, date, or role.
4. **Start the day** offers building measurements if that job has none. Hold **Finish the day** — the film is saved on the phone and files to the dashboard when a signal is available. If measurements were skipped, the phone asks once more at the end. The job then lands on **My jobs**.

AI dictation and twin review stay in the **office Verifier**.

## API (account-linked)

On a physical iPhone the app talks to the Atmosphere Supabase project
(same users and jobs as the website). A local BFF is optional in Simulator.

1. Create account: BFF `POST /api/field-app/register` (email + password + join code or new office name), or Supabase `POST /auth/v1/signup` plus `create_org` / `join_org`
2. Sign-in: `POST /auth/v1/token?grant_type=password` (or BFF `POST /api/auth/login`)
3. Today’s assigned jobs: BFF `GET /api/field-app/today`. Filmed history: `GET /api/field-app/jobs?q=` (name, address, job number, status, date, role)
4. Add a job from the phone: BFF `POST /api/field-app/jobs` (creates the property, job, and assigns this login — it shows on Today until filmed)
5. Day film: upload into the `job-proofs` bucket, then insert `job_proofs`
6. Optional RoomPlan twin still uses the BFF geometry routes when one is running

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
The app follows the iPhone’s **Light / Dark** appearance — it does not lock to light mode.

## Still to wire in Xcode

- App Store Connect listing, TestFlight, privacy nutrition labels
- Associated Domains so `https://…/shared/{token}` opens the app without the custom scheme

Each crew member signs in with their own Atmosphere account. Job invites (`atmosphere-field://share?token=…` or a pasted `/shared/…` URL) are accepted **inside the app** after sign-in — not on the login screen — and add that job to this login’s Today. Day films stay on the phone until there is a path, then a background `URLSession` files them to the dashboard. Building measurements (RoomPlan on a LiDAR iPhone) are offered at the start of a recording and again at the end only when that job still has none.
