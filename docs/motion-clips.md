# Robotics-ready motion clips

Label **narrow trade motions** (screw, cut, measure, drill, …) from verified
Field Capture / job videos as a **skill corpus** foundation for future robotics
and training. Timed segments live on the proof; Internal and Platform browse by
motion type.

## Rules

1. **Evidence only** — a clip needs a real action description from analysis.
   Empty, low-confidence, `wait`, and `other` rows are dropped. Atmosphere
   **never invents** a motion that is not evidenced.
2. **Privacy excluded** — any segment that overlaps
   `ai_findings.privacyRedactions` is omitted (`excludedForPrivacy` counts them).
3. **Closed vocabulary** — each clip maps onto `WORK_ACTIONS`
   (`backend/src/episodes/actions.ts`). Narrow labels (`screw`) are used when
   tool/description evidence supports them; otherwise the closed verb
   (`fasten`) is the motion label.
4. **Timed** — `startSec` / `endSec`. If vision only gave a point timestamp, a
   short window is inferred (`durationInferred: true`, default 2s).

## Persistence

Stored on the proof as `ai_findings.motionClips`:

```json
{
  "version": 1,
  "schema": "atmosphere.motion_clips.v1",
  "clips": [
    {
      "startSec": 12.0,
      "endSec": 18.4,
      "action": "fasten",
      "motion": "screw",
      "description": "Driving screws into the top plate",
      "toolLabel": "impact driver",
      "objectLabel": "top plate",
      "materialLabel": null,
      "room": "attic",
      "confidence": 0.88,
      "source": "ai_vision",
      "durationInferred": false
    }
  ],
  "excludedForPrivacy": 0,
  "model": "…",
  "updatedAt": "…"
}
```

Written whenever `persistProofActions` runs (after narration / vision actions
land). Also derived on read from `job_proofs.actions` when the stored blob is
missing (still respecting privacy).

## API

| Path | Who | Purpose |
| --- | --- | --- |
| `GET /api/motion-clips/types` | signed-in | Known narrow + closed labels |
| `GET /api/motion-clips` | org member | Org corpus, `?motion=&jobId=` |
| `GET /api/motion-clips/job/:jobId` | org member | Job file browse / Platform panel |
| `GET /api/motion-clips/staff` | internal analytics | Cross-org staff browse |

Proof catalog (`GET` proofs for a job) also includes `motionClips` per video.

## Surfaces

- **Platform** job file: `MotionClipsBrowser` — filter chips by motion type.
- **Internal**: `/motion-clips` — staff corpus browse by motion type.

## Not in this slice

- Exporting a robotics training package / WebDataset
- Human relabel UI
- Separate media derivatives per motion (uses seek on the parent proof)

## Tests

- `backend/test/motionClips.test.ts`
- `frontend/src/components/shared/MotionClipsBrowser.test.tsx`
