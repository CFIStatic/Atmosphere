# Private moment redaction

Automatically identify private intervals in Field Capture / job videos and
block them out for viewers: **blur video + mute audio** for those ranges;
outside those ranges playback is normal.

Example: a worker walks into a bathroom while still recording → analysis marks
the interval and players mute + heavily blur that stretch.

## Phase 1 (shipped)

1. **Detect** during vision dictation + heuristic enrichment
   (`backend/src/audio/privacyRedactions.ts`, prompt in `videoIntelligence.ts`).
   Targets bathroom/toilet/shower, locker/changing rooms, undressing /
   nudity-adjacent, clearly intimate spaces. Prefer high precision with lean
   toward over-redacting private spaces. Confidence is always recorded; never
   invent a private room that is not evidenced.
2. **Persist** on the proof as `ai_findings.privacyRedactions`:
   `{ version, ranges: [{ startSec, endSec, reason, confidence, source }], model? }`.
3. **Apply** in Platform / job-file players (`JobFilePlayer`): force mute + CSS
   blur while the playhead is inside a range; seeking into a range stays
   redacted; captions hide for that interval. Subtle “Privacy protected” badge.
4. **Ask / Analysis**: transcript lines and evidence-log speech inside ranges
   become `[privacy redacted]` so Ask cannot quote them verbatim.
5. **UI**: player hint “Privacy-protected segments on file”; Global Admin can
   inspect `ai_findings.privacyRedactions` (and the player title tooltip) without
   blocking ship. Inline range editor is deferred.

Stored ranges are authoritative for clients. Phase 1 does **not** re-encode the
underlying media object — share/export of the raw signed URL could still expose
bytes. Treat client enforcement + stored ranges as the product guarantee for
in-app playback and Ask.

## Phase 2 (follow-up)

Server-side path for share / export:

- FFmpeg (or equivalent) re-encode that blacks out / blurs video and strips /
  mutes audio for each stored range, writing a `privacy_safe` derivative.
- Prefer serving that derivative for share links and downloads; keep the
  original under stricter custody for Global Admin / legal hold only.
- Optional: signed playback tokens that only mint URLs for the safe derivative.

Until phase 2 ships, document that external share of the original file is out
of scope for privacy enforcement, and prefer in-app players.

## Tests

- Schema / derive / merge: `backend/test/privacyRedactions.test.ts`
- Dictation JSON parse: `backend/test/videoIntelligence.test.ts`
- Ask transcript scrub: `backend/test/clipAsk.test.ts` (privacy cases)
- Player mute/blur: `frontend/src/components/shared/JobFilePlayer.test.tsx`
