# Silent panic / wellness check

When a Field Capture recording shows **long no-motion** while the crew looks
**alone on site**, Atmosphere opens a `silent_panic_wellness` safety incident and
nudges the office. Operators **acknowledge or dismiss** in Platform. Atmosphere
**never calls 911**.

Coordinates with near-real-time emergency detection (`docs/safety-alerts.md`) —
same `safety_incidents` table, ack/dismiss API, and alert fanout — but a
separate category and heartbeat path.

## Signals

| Signal | Source |
| --- | --- |
| **Motion score** | Field Capture frame-diff on the live preview (~every 20s). Score ≥ 0.04 resets the no-motion clock. |
| **Alone on site** | Client reports `aloneOnSite` (default true for a single active capture). Org may require this. |
| **Recording active** | Heartbeats only while the day film is rolling. |

## Configurable thresholds (per org)

| Setting | Default | Notes |
| --- | --- | --- |
| `wellness_check_enabled` | `true` | Master switch. |
| `wellness_no_motion_seconds` | `300` (5m) | Opens a **watch** incident. |
| `wellness_critical_after_seconds` | `600` (10m) | Escalates to **critical** (email + banner). Clamped ≥ no-motion. |
| `wellness_require_alone` | `true` | If true, skip alerts when `aloneOnSite` is false. |

Update via `PATCH /api/safety/settings` (global_admin):

```json
{
  "wellnessCheckEnabled": true,
  "wellnessNoMotionSeconds": 300,
  "wellnessCriticalAfterSeconds": 600,
  "wellnessRequireAlone": true
}
```

## API

```
POST /api/field-app/jobs/:jobId/proof/wellness-heartbeat
POST /api/job-share/.../proof/wellness-heartbeat

GET  /api/safety/settings
PATCH /api/safety/settings

POST /api/safety/incidents/:id/ack
POST /api/safety/incidents/:id/dismiss
```

Heartbeat body (sketch):

```json
{
  "motionScore": 0.02,
  "aloneOnSite": true,
  "recordingActive": true,
  "clipId": "…",
  "clipTimestampSeconds": 420,
  "lat": 41.8,
  "lon": -87.6
}
```

## Policy

- Recommended action is `monitor` (watch) or `dispatch_help` (critical) —
  **never** `contact_authorities` for wellness alone.
- Same rate-limit as other safety categories: open job+category within 10 minutes
  reuses the existing incident (no alert spam).
- Authorities auto-escalate org flag does **not** apply to wellness incidents.

## Surfaces

- **Platform → Safety:** wellness incidents appear alongside emergency flags.
- **Office job file:** critical open incidents (including wellness) show the
  safety banner with Ack / Dismiss. Watch wellness is listed in open incidents.
