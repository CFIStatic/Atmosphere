# Atmosphere Field Capture — App Store (iOS)

Native iPhone client for the same Field Capture product: **one button to film
the day**, plus **on-device measurement** that feeds a **property digital twin**.

This folder documents the contract the Swift app implements against the
Atmosphere API. The web `fieldcapture/` prototype remains the product face and
demo; the App Store build is the measuring instrument.

## Why native

Metric scale for a digital twin needs depth and room reconstruction:

| Capability | Role |
|---|---|
| **RoomPlan / ARKit / LiDAR** | Measure rooms, openings, optional USDZ mesh |
| **Camera + microphone** | Day-length work video (same proof / media pipeline) |
| **Core Location** | Job attribution while rolling |

RGB video alone is **evidence**, not a room tape measure. The server will not
invent feet and inches from pixels; the phone posts measured rooms.

## Crew flow (unchanged)

1. Tap **Start the day** — recording begins; RoomPlan/ARKit can run alongside.
2. Work the jobs — GPS + clock ride with the film; no job picker.
3. Hold **Finish the day** — upload video, then POST device geometry.

AI dictation and twin review stay in the **office Verifier / twin view**.

## API contract

Base: authenticated org session (same cookies / token model as the web app).

### 1. Open a capture session

`POST /api/geometry/sessions`

```json
{
  "platform": "ios",
  "measureApi": "roomplan",
  "lidarAvailable": true,
  "jobId": "optional-job-id",
  "label": "Meridian Ave — Aug 6"
}
```

Returns `{ session, twin, summary }`. Keep `session.id` and `twin.id`.

### 2. Upload the day video

Use existing proof / media upload (`/api/job-share/.../proof` or storage
signed URL + `POST /api/media/video/process` for dictation). Hold the
`videoRef` (storage path or media id).

### 3. Ingest measurements → twin

`POST /api/geometry/sessions/:id/ingest`

```json
{
  "source": "roomplan",
  "rooms": [
    {
      "name": "Living",
      "lengthFt": 16,
      "widthFt": 12,
      "heightFt": 8,
      "openings": [{ "kind": "door", "width": 3, "height": 7 }],
      "confidence": 0.92
    }
  ],
  "mesh": {
    "format": "usdz",
    "url": "https://…/signed/meridian.usdz",
    "producedBy": "roomplan"
  },
  "videoRef": "org/…/day.mp4",
  "work": [
    {
      "label": "Flood cut — living south wall",
      "status": "in_progress",
      "scopeTitle": "Remove wet drywall to 24\""
    }
  ]
}
```

Rooms become estimator-compatible `RoomMeasurements` on the twin. Mesh URL
is optional but preferred for a true 3D view in the office.

### 4. Video without LiDAR

If the device has no LiDAR / RoomPlan failed, still upload video and:

`POST /api/geometry/twins/:id/video` with `{ "videoRef": "…" }`

Twin status becomes `needs_review` until DocuSketch or a later measure pass
supplies metric rooms.

### Capabilities

`GET /api/geometry/capabilities` — metric sources, mesh formats, device APIs.

## Suggested Swift stack

- **RoomPlan** (`RoomCaptureSession`) → rooms + USDZ
- **ARKit** world tracking when RoomPlan is unavailable
- **AVFoundation** for the day recording (or ReplayKit if product chooses)
- **Background URLSession** for large day uploads
- Atmosphere REST client sharing auth with the web session where possible

## Product boundary

| On phone | In office |
|---|---|
| Film + measure | Watch video + AI dictation |
| Upload mesh / rooms | Inspect / edit digital twin |
| Door checks | Scope verdicts, estimating from twin rooms |

DocuSketch remains a supported alternate geometry source for the same twin
room graph (`docusketch` in `GEOMETRY_SOURCES`).
