# Field Capture phone app (Capacitor)

The iPhone app (and later Android) is **the Field Capture website,
https://app.atmosphereteam.com, inside a native shell**. Same screens, same
sign-in, same recording and filing code (`fieldcapture/`). It replaces the
separate Swift app in `apps/field-ios` (kept in the repo for now).

```
apps/mobile/
  capacitor.config.json   app id, server.url, allowed hosts
  www/                    placeholder + offline page (not the app itself)
  ios/                    Xcode project (Swift Package Manager, no CocoaPods)
  android/                Android Studio project
  test/                   App Store basics checked without Xcode (npm test)
```

## Why `server.url` instead of bundling `fieldcapture/`

The app opens `https://app.atmosphereteam.com` directly (`server.url`).

- **It is identical by construction.** Every website deploy is the app's deploy;
  nothing to rebuild or resubmit for web changes.
- **Sign-in works unchanged.** Field Capture calls same-origin `/api` (nginx
  proxy) and keeps the Platform session in a first-party, httpOnly cookie, so
  a relaunch signs straight back in. Bundled files would run on
  `capacitor://localhost`, where that cookie is third-party (blocked by
  WebKit), `/api` is cross-origin (CORS + CSP changes) and the session would
  not be shared with the Platform.
- **Trade-off:** Capacitor documents `server.url` as meant for live reload, and
  the app needs signal to *open*. If the first load fails, the app shows
  `www/offline.html` ("No connection" + Try again). Once open, recording
  offline and the on-phone filing queue (IndexedDB) work as on the website.

Navigation: `app.atmosphereteam.com` and `platform.atmosphereteam.com` stay in
the app (`server.allowNavigation`); any other link, and anything opened with
`target=_blank`, opens in Safari. The Platform tab's iframe is unaffected.

## Native pieces

| Need | How |
| --- | --- |
| Camera / mic in the web view | Capacitor's WKWebView delegate grants `getUserMedia` for the page, so after the one iOS prompt there are no repeated web prompts. Strings: `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`. |
| Location | `@capacitor/geolocation`. `fieldcapture/js/native-bridge.js` answers `navigator.geolocation` from the plugin inside the app, so there is one iOS prompt (`NSLocationWhenInUseUsageDescription`) instead of a web prompt on each launch. |
| Screen stays on while filming | `@capacitor-community/keep-awake`, switched on/off by the bridge on `fieldcapture:recording-start` / `-stop` (events from `app.js`). |
| Phone locks / app closed / a call takes the mic | The bridge sends `fieldcapture:finish-now`; `app.js` finishes the day exactly as the Finish button does (stop → save on the phone → file in the background) and the door says why it stopped. `SceneDelegate` asks iOS for its short background time so that save can finish. |
| Account deletion (5.1.1(v)) | Account menu → **Delete account** (website and app), `DELETE /api/auth/account`. |

The bridge only acts when `window.Capacitor.isNativePlatform()` is true, so the
website in a normal browser is unchanged.

App Store basics: `PrivacyInfo.xcprivacy`, `ITSAppUsesNonExemptEncryption = NO`,
no `UIBackgroundModes`, iPhone-only portrait, 1024 px app icon without alpha,
bundle id `com.atmosphere.fieldcapture`, version from `MARKETING_VERSION` /
`CURRENT_PROJECT_VERSION`, `DEVELOPMENT_TEAM` empty (Codemagic signs).

## Commands (Node 22+)

```bash
cd apps/mobile
npm ci
npm test               # plist / privacy manifest / icons / permissions
npx cap sync           # copy www + config, regenerate the plugin package lists
npx cap open ios       # Xcode (on a Mac)
```

## Codemagic + Apple (one-time)

1. **Apple Developer Program** membership for the company.
2. **App ID**: developer.apple.com → Identifiers → App ID
   `com.atmosphere.fieldcapture` (no extra capabilities needed).
3. **App record**: App Store Connect → Apps → + New App, iOS, bundle id
   `com.atmosphere.fieldcapture`, name "Field Capture" (or the chosen store name).
4. **API key**: App Store Connect → Users and Access → Integrations → App Store
   Connect API → + key with **App Manager** access. Download the `.p8` once;
   note Issuer ID and Key ID.
5. **Codemagic → Team settings → Team integrations → Developer Portal → Manage
   keys → Add key**: name it exactly **`atmosphere_asc`**, enter Issuer ID, Key
   ID, upload the `.p8`.
6. **Signing key (automatic signing, nothing to upload by hand)**: make an
   RSA 2048 private key on a Mac:
   `ssh-keygen -t rsa -b 2048 -m PEM -f ios_distribution_private_key -q -N ""`.
   In the Codemagic app → Environment variables, add `CERTIFICATE_PRIVATE_KEY`
   = the whole file contents (including the BEGIN/END lines), **Secret** on,
   group **`ios_signing`**. Each build then runs `app-store-connect
   fetch-signing-files com.atmosphere.fieldcapture --type IOS_APP_STORE --create`,
   which finds or creates the Apple Distribution certificate for that key and
   the App Store profile. Keep the key file safe: it is the same certificate
   on every build. Apple allows only a few distribution certificates per team.
7. **Codemagic → Add application** → this GitHub repo → codemagic.yaml.
   Optionally set `APP_STORE_APPLE_ID` (the app's Apple ID number) as an
   environment variable so build numbers follow TestFlight.
8. Start the **ios-testflight** workflow. It uploads to App Store Connect and
   submits to TestFlight; add testers in App Store Connect → TestFlight.
9. Before App Review: App Privacy answers matching `PrivacyInfo.xcprivacy`
   (email, name, user ID, precise location, audio, photos/videos, other user
   content — linked to the user, app functionality, no tracking), privacy
   policy URL, screenshots, a demo account for the reviewer, and a note that
   the app records the workday with camera/mic and files it to the company.
