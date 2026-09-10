# Field Capture iOS ↔ web parity

**Canonical crew web:** `https://app.atmosphereteam.com` (`fieldcapture/`).  
**iOS target:** `apps/field-ios/`.  
**Product:** Atmosphere · **what we do:** Work Verification · Jettx LLC is holding only.

## Host story

| Surface | Role |
|---|---|
| `https://app.atmosphereteam.com/` | **Canonical** crew PWA (Railway Field Capture → `fieldcapture/Dockerfile`) |
| `https://field-capture-production.up.railway.app/` | Railway default URL for the same service |
| `https://platform.atmosphereteam.com/fieldcapture/` | Office nginx **embed** of the same `fieldcapture/` tree — **keep**; do not delete |
| Repair workflow `repair-field-capture-config.yml` | Keep — stamps Config File + keeps Autodeploy green |

One source tree: `fieldcapture/`. Both Docker images (standalone FC + office frontend) bake that tree. iOS never loads the web shell; parity is behavioral + API contract. iOS talks to the BFF (`atmosphere-production.up.railway.app`), not the static FC host.

## Critical parity (Phase C1–C3)

| Area | Web | iOS |
|---|---|---|
| Client `clipId` on upload URLs | Minted per film; sent on `upload-url` / `upload-part-url` | `ClipId.mint()` + sent on begin / parts / proof echo |
| Record another | Door CTA, same job | Door **Record another** → camera on same `activeJobId` |
| Save-first queue | IndexedDB + forever retry | `DayFilmQueueStore` (disk + JSON) + `DayFilmUploadQueue` |
| Multipart / stitch | `upload-part-url` + `upload-complete` (and slot `parts`) | Same; long films prefer multipart, else whole PUT |
| Survive kill | Yes | Yes — queue reloads on launch / foreground |

## Still open (C4+)

- Create job + Places + offline drafts (C4)
- Job-share `?token=` / universal link (C5)
- Account → Support / Settings / theme (C6)
- Offline Today cache + filing strip polish (C7)
- Tighten BFF-first / reduce silent Supabase proof path (C8)
- Live stream-while-recording parts (web MediaRecorder chunks); iOS post-finish multipart covers long films; optional live streamer later
- True `URLSessionConfiguration.background` app-delegate handoff for multi-GB while suspended

## Native-only (intentional)

RoomPlan twin on the door, App Store install, no Platform iframe tab.
