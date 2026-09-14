# Homeowner live progress story

Plain-English timeline of **what happened** on a job, shown on Platform
`/job-progress` and guest `/progress` shares.

## Behavior

- **Glance first.** Each filed clip contributes a one-sentence headline from
  Analysis conversation executive summary / summary (or AI summary fallback).
- **Scan on demand.** Expanding a moment reveals who was present, key moments,
  agreements, refusals, and next steps — same spirit as Analysis Glance → Scan,
  without Full evidence / verbatim transcript.
- **Chronological.** Moments are ordered by work date, then received time.
- **Privacy.** Text that hits private-moment heuristics or clips with
  `privacyRedactions` never quote bathroom / intimate intervals. Protected
  clips show “Privacy-protected segment omitted.”
- **Calm.** Empty jobs say clips will fill in; no invented work.

## Surfaces

| Surface | Source |
|---------|--------|
| Guest `/progress/:token` | `liveStory` on progress-share payload (+ client fallback from `proof.videos`) |
| Office / homeowner `/job-progress` | Built client-side from `proof.videos` |

## API

Progress-share guest JSON includes:

```json
"liveStory": {
  "overview": "…",
  "moments": [{ "id", "workDate", "whenLabel", "glance", "scan", "people", "privacyProtected" }],
  "clipCount": 2,
  "withGlanceCount": 1
}
```

Composed by `backend/src/shared/homeownerLiveStory.ts`.

## Tests

- `frontend/src/components/shared/jobLiveProgressStory.test.ts`
- `frontend/src/components/shared/JobProgressDashboard.test.tsx`
- `frontend/src/lib/privacyText.test.ts`
- `backend/src/shared/homeownerLiveStory.test.ts`
