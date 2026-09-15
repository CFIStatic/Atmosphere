# Field Capture recording consent / disclosure

**Critical audit gap:** Field Capture used to start recording with no versioned
recording-on-property disclosure artifact. Worker Terms of Service acceptance is
**not** enough — this notice is separate.

## What ships

| Piece | Role |
|---|---|
| `RECORDING_DISCLOSURE_VERSION` (`recording-disclosure-v1`) | Version string clients must POST |
| `RECORDING_DISCLOSURE_TEXT` | Clear product disclosure (not legal final) |
| `recording_acknowledgments` table | Durable ack: job, actor user, work day, version, optional property / party |
| Pre-record gate (iOS + web Field Capture) | User must acknowledge before `startRecording` |
| Production upload check | Proof upload / assemble / file reject with `recording_ack_required` if missing |

## API

Authenticated Field Capture:

- `GET /api/field-app/recording-disclosure`
- `GET /api/field-app/jobs/:jobId/recording-ack?workDate=YYYY-MM-DD`
- `POST /api/field-app/jobs/:jobId/recording-ack`  
  Body: `{ disclosureVersion, workDate? }`

Job-share (invitee account):

- `GET|POST /api/job-share/:token/recording-ack`
- `GET /api/job-share/:token/recording-disclosure`

## Client gate

1. Before starting the camera day, show the disclosure text.
2. Require an explicit checkbox acknowledgment.
3. POST the ack (or cache locally for phone-only draft jobs, then flush when the job remaps to a server id).
4. Only then call `startRecording` / `startLiveDay` / `startDay`.

## Server validation (least-breaking)

- **Clients** require ack before start (primary control).
- **Production** `createUploadUrl`, `createPartUploadUrl`, `completeChunkedProofUpload`, and `recordProof` call `assertRecordingAckForProof` for the party’s job + `workDate` + live disclosure version.
- Non-production skips the hard block so local / CI capture still works before the table is applied.

## Bumping the disclosure

1. Edit `RECORDING_DISCLOSURE_TEXT` and bump `RECORDING_DISCLOSURE_VERSION` in:
   - `backend/src/legal/recordingDisclosure.ts`
   - `fieldcapture/js/capture-core.js`
   - `apps/field-ios/.../AtmosphereClient.swift`
2. Crews must acknowledge again for each job/day under the new version.

## Out of scope

Full e-sign by the homeowner. Do not invent compliance claims (HIPAA/GDPR/etc.) in the UI.
