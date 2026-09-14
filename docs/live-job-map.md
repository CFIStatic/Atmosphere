# Live job map (office Platform)

One Platform screen that answers: **who is filming / on site right now**,
**where was the last geo ping**, and **which open safety flags** need eyes.

Route: `/live-map` (office rail → **Live map**).
API: `GET /api/operations/live-map`.

## What this MVP uses (sold path)

| Signal | Source | Meaning on the map |
| --- | --- | --- |
| Site pin | `crm_properties.latitude/longitude` | Job address from intake |
| Last device ping | Latest `job_proofs.lat/lon` + `received_at` | Phone geo at proof upload |
| On site | `job_parties.last_seen_at` within 15 minutes | Someone opened Field Capture / share |
| Uploading | Unexpired `media_upload_sessions` linked via `media_objects.ref_id` | Bytes still landing |
| Recent upload | Proof `received_at` within 30 minutes | Just filed film |
| In progress | `crm_jobs.status = in_progress` | CRM says work is underway |
| Open safety | `safety_incidents` status `open` | Near-real-time emergency flags |
| People | `job_assignments` + invitee parties | Who is on the job |

## Gaps (documented, not hidden)

1. **`/api/locations` and `crew_locations` were removed** with the non-sold-path
   cleanup. There is no opt-in continuous crew GPS. Do not resurrect that product
   casually — it had consent, retention, and legal constraints of its own.
2. **No continuous Field Capture filming heartbeat.** "On site" is inferred from
   party `last_seen_at` and recent proofs, not from a while-recording ping.
3. **`geometry_capture_sessions` / twins** were dropped — room-tree geo is unused.
4. **Safety live samples** only persist when classification hits; sparse JPEG
   samples (~25s) do not leave a heartbeat row on a quiet day.
5. **True WebRTC sub-second live** remains TODO (`docs/safety-alerts.md`).
6. **Upload → job linkage** depends on `media_objects.ref_type/ref_id`; sessions
   without that link will not light an uploading pin.

## UX

List + map hybrid: jobs without coordinates still appear in the list; pins use
proof geo when present, otherwise property geo. Critical open safety flags sort
to the top. Polls about every 30s while the tab is visible.
