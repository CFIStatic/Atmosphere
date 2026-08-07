# Geometry · property digital twin

Source-agnostic **room graph + mesh + work video** for a property.

## Sources of truth (metric)

1. **App Store Field app** — RoomPlan / ARKit / LiDAR (`arkit`, `roomplan`, `lidar`)
2. **DocuSketch** — existing estimator scan connector (`docusketch`)
3. **Manual / notes** — fallbacks

**Field day video** attaches as evidence and work overlay. It does **not**
create scale by itself (`video_evidence`).

## Modules

| File | Role |
|---|---|
| `types.ts` | Twin, session, device ingest shapes |
| `fromDevice.ts` | Device rooms → `RoomMeasurements` |
| `store.ts` | In-memory twin/session store (foundation) |
| `twin.ts` | Ingest + summarize |
| `../routes/geometry.ts` | `/api/geometry/*` |

Rooms are compatible with `estimator/types.RoomMeasurements` so a twin can
feed mitigation / construction estimating later without a second model.

## HTTP

- `GET /api/geometry/capabilities`
- `POST /api/geometry/twins`
- `GET /api/geometry/twins` · `GET /api/geometry/twins/:id`
- `POST /api/geometry/sessions`
- `POST /api/geometry/sessions/:id/ingest`
- `POST /api/geometry/twins/:id/video`
