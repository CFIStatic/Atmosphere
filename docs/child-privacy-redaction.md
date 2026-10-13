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
5. **Mandatory**: child privacy blur is **always on** for every org. There is
   no Settings toggle and orgs cannot opt out. Detection, player blur, and Ask
   redaction run for all orgs. (`orgs.child_blur_enabled` may still exist from
   an earlier optional policy; application code ignores stored `false`.)

Stored ranges are authoritative for clients. Phase 1 does **not** re-encode the
underlying media — share/export of the raw signed URL could still expose bytes
(same as private moments). Treat client enforcement + stored ranges as the
in-app guarantee.

## Phase 2 (shipped): blurred copy

`backend/src/lib/proofPrivacySafe.ts` burns a full-frame blur (and mute, where
the player mutes) through every child and private-moment range, padded 1 s
before and 1.5 s after, into `*.safe-<hash>.mp4` beside the original. The hash
covers the ranges, so a re-analysis builds a fresh copy.

- **Download** always hands out the blurred copy for a clip with ranges, for
  everyone (contractor included). If the copy cannot be built, the download
  is refused; it never falls back to the original.
- **Playback** (`proofVideoUrl`) serves the blurred copy once it exists.
  Until then it serves the original plus `privacyWindows`, and the Dashboard
  player (`verifier/index.html`) blurs and mutes through them; the job-page
  player blurs from the clip's stored ranges as before.
- **Posters and stills** never come from inside a window; the Dashboard never
  grabs its own still from the original of such a clip.
- **Evidence report PDF** drops stills and quotes inside child ranges.
- The Dashboard library kicks the build for a few flagged clips per load so
  the copy is usually ready before anyone presses Play or Download.

Detection hardening: vision ranges padded 2 s / 3 s, boxes widened 50% per
side, boxed ranges longer than 10 s blur the whole frame, a full-frame range
merged with a boxed one stays full-frame, and everyday words (boy, girl, son,
daughter, little ones…) count as a child.

## Phase 2 notes (original plan)

Server-side path for share / export (same plan as private moments):

- FFmpeg (or equivalent) re-encode that blurs faces/regions (or full frame) for
  each stored child + private range, writing a `privacy_safe` derivative.
- Prefer serving that derivative for share links and downloads.

Until phase 2 ships, external share of the original file is out of scope for
privacy enforcement; prefer in-app players.

### Guest / share raw mint (MVP, Phase 1.5)

Same gate as private moments: guest/progress/verifier-share token surfaces
refuse raw signed playback/download when `childPrivacyRedactions` (or private
moment) ranges exist. Soft-deleted media is unreachable; job delete revokes
share tokens. See `backend/src/shared/guestMediaAccess.ts`.


## Tests

- Schema / derive / merge: `backend/test/childPrivacyRedactions.test.ts`
- Dictation JSON parse: `backend/test/videoIntelligence.test.ts`
- Player blur: `frontend/src/components/shared/JobFilePlayer.test.tsx`

## Live / near-live office view

Office **Live** may lag analysis: child blur ranges apply after file + dictation. Live can be raw until then. See `docs/office-live-view.md`.
