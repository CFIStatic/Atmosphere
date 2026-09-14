# Field Capture safety alerts

Near-real-time emergency detection on Field Capture video so the office can
dispatch help when something goes wrong on site (contractor falls alone,
violence, medical distress, verbal threats of serious harm).

## What shipped

| Piece | Behavior |
| --- | --- |
| **Live sample** | While recording, Field Capture posts sparse JPEG frames (~every 25s) to `POST …/proof/safety-sample`. |
| **Upload chunk path** | Same endpoint can be called as parts stream (`source: upload_chunk`). |
| **Post-upload** | When a proof is filed with client frames, a safety scan runs async. |
| **Transcript** | After Whisper finishes, transcript heuristics scan for threats / distress. |
| **Incidents** | Rows in `safety_incidents` with severity `watch` \| `critical`, confidence, clip timestamp, job/location metadata. |
| **Alerts** | Critical → email org global admins (+ optional `safety_alert_emails`); optional HTTPS webhook; always visible in Platform **Safety**. |
| **Ack / dismiss** | Platform staff + org members can acknowledge or dismiss (false positive). Rate-limit: same job+category within 10 minutes reuses the open incident. |

## Real-time vs near-real-time

- **Near-real-time (shipped):** analysis as upload chunks / live preview frames arrive, and shortly after segment upload or transcript completion. Latency is typically seconds to a couple of minutes depending on model availability and network.
- **True real-time / WebRTC (TODO):** sub-second MediaStream track sampling is **not** wired. See `backend/src/safety/sample.ts` TODO.

## Categories (high precision bias)

- `fall_person_down`
- `physical_violence`
- `verbal_threat` (transcript)
- `medical_distress`
- `other_emergency` (vision model only)

Ambiguous footage is a **miss**. Confidence floors: watch ≥ 0.72, critical ≥ 0.85.

## Authorities escalation policy (gated)

**Atmosphere never calls 911, police, or emergency APIs.**

1. Critical incidents that look like violence or threats set
   `recommendedAction: contact_authorities`.
2. Org column `orgs.safety_auto_escalate_to_authorities` defaults to **`false`**.
3. When an admin sets it to `true` (Platform settings API
   `PATCH /api/safety/settings` with `{ "autoEscalateToAuthorities": true }`),
   alert payloads include `escalateToAuthorities: true`.
4. That flag is for **your** webhook / ops runbook. Prefer a human confirm step
   before any external emergency call. Turning the flag on later does **not**
   enable Atmosphere to dial anyone — you still must integrate and operate that
   path yourself.

Also configurable:

- `safety_alert_webhook_url` (HTTPS JSON POST)
- `safety_alert_emails` (extra recipients beyond global admins)

## API sketch

```
POST /api/field-app/jobs/:jobId/proof/safety-sample
POST /api/job-share/.../proof/safety-sample

GET  /api/safety/incidents?jobId=&status=open
POST /api/safety/incidents/:id/ack
POST /api/safety/incidents/:id/dismiss
GET  /api/safety/settings
PATCH /api/safety/settings   # global_admin

GET  /api/safety/staff/incidents   # Platform internal
POST /api/safety/staff/incidents/:id/ack
POST /api/safety/staff/incidents/:id/dismiss
```

## Surfaces

- **Platform (internal):** Safety nav → open incidents, Ack / Dismiss.
- **Office job file:** critical open incidents show a banner with Ack / Dismiss.

## Related: silent panic / wellness

Long no-motion + alone-on-site heartbeats open category `silent_panic_wellness`
with configurable org thresholds. Same ack/dismiss and alert channels; never
auto-911. See `docs/wellness-check.md`.
