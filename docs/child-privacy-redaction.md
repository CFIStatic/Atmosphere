# Child privacy redaction

Automatically detect children (minors) in Field Capture / job videos and blur
them for viewers. **Protective privacy only** — age appearance estimate as
child vs adult. **Never** identify, name, reverse-search, or build face IDs
for children.

Coordinates with [private moment redaction](./privacy-redaction.md) as a
parallel category `child_privacy` stored under
`ai_findings.childPrivacyRedactions`.

## Phase 1 (shipped)

1. **Detect** during vision dictation + heuristic enrichment
   (`backend/src/audio/childPrivacyRedactions.ts`, prompt in `videoIntelligence.ts`).
   Targets people who appear to be minors. Skip `cannotTell`. Confidence
   threshold (≥ 0.55). Never invent a child who is not evidenced.
2. **Persist** on the proof as `ai_findings.childPrivacyRedactions`:
   `{ version, category: "child_privacy", ranges: [{ startSec, endSec, reason,
   confidence, source, regions? }], model? }`.
   Optional `regions` are normalized 0–1 boxes for face/body blur when available.
3. **Apply** in Platform / job-file players (`JobFilePlayer`):
   - Prefer **region blur** when boxes exist (no mute).
   - Otherwise **full-frame blur + mute** (whole frame redacted), matching
     private-moment v1 behavior.
   - Private-moment ranges and child ranges both enforce; private moments always
     mute + full-frame blur.
4. **Ask / Analysis**: speech and identifiable child descriptions become
   `child present [privacy redacted]`.
5. **Org policy**: `orgs.child_blur_enabled` (default **true**). Settings →
   Organization → Child privacy blur. When off, new detections are skipped and
   API payloads omit child ranges.

Stored ranges are authoritative for clients. Phase 1 does **not** re-encode the
underlying media — share/export of the raw signed URL could still expose bytes
(same as private moments). Treat client enforcement + stored ranges as the
in-app guarantee.

## Phase 2 (follow-up)

Server-side path for share / export (same plan as private moments):

- FFmpeg (or equivalent) re-encode that blurs faces/regions (or full frame) for
  each stored child + private range, writing a `privacy_safe` derivative.
- Prefer serving that derivative for share links and downloads.

Until phase 2 ships, external share of the original file is out of scope for
privacy enforcement; prefer in-app players.

## Tests

- Schema / derive / merge: `backend/test/childPrivacyRedactions.test.ts`
- Dictation JSON parse: `backend/test/videoIntelligence.test.ts`
- Player blur: `frontend/src/components/shared/JobFilePlayer.test.tsx`
