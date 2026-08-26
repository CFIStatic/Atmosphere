# Physical-work records in Atmosphere

Atmosphere already films the day and verifies it. This document interprets the
physical-work dataset idea as **that same product**, not a second system.

The atomic unit is not a video. It is a **work episode**: what was supposed to
happen, what the place looked like, what a body did, with which tools and
materials, what changed, whether anyone other than the model agreed, and what
happened later. Video is evidence attached to that record.

## What already ships

| Idea | Atmosphere today |
| --- | --- |
| TaskEpisode | `work_episodes` — one per party per work day, created on Field Capture upload |
| TaskAction | `episode_actions` + closed verbs in `backend/src/episodes/actions.ts` |
| Tools / materials | `episode_resources`, plus labels on each action |
| Evidence | `episode_observations` → `job_proofs` (hash, GPS, checks, dictation) |
| Ground truth | `episode_verifications` — append-only; `ai_analysis` is not inspector sign-off |
| Later consequence | `episode_outcomes` (callback, leak, `no_failure_observed`) |
| Cost | `episode_economics` |
| Place | `job_locations` |
| Ontology | `backend/src/episodes/ontology.ts` (water mitigation seeded; other trades stubbed) |
| Rights | `work_episodes.data_rights` + `worker_consent` (default `job_only` / `not_asked`) |
| Dataset quality | `backend/src/episodes/tiers.ts` — unknown is not pass; AI cannot lift past Tier 2 |
| Verification dataset layer | `rights_manifests`, `dataset_examples`, JSONL export (frame-level verification) |

The sold path stays Verification + Field. Office intake and Field Capture do
not change. An episode is enrichment of a proof that is already complete
without it.

## What Phase 1 adds

The missing pieces were not “store more video.” They were the structured
reading of a day that a buyer, a model, or a later robot actually trains on.

| Idea | Phase 1 table / API |
| --- | --- |
| WorldState (before / after) | `episode_world_states` — filled from proof findings + narration |
| EvidenceAsset | `episode_evidence_assets` — pointer + hash, not a second blob store |
| AIAnnotation history | `episode_annotations` — append-only; model v1 vs v2 vs human |
| Immediate TaskOutcome | `episode_immediate_outcomes` — AI day verdict; **not** ground truth |
| Training example | `GET /api/episodes/:id/training-export` — rights-gated JSON |
| Office surface | Proof of work panel reads `GET /api/episodes/:id/physical-work` |
| Metric | “Verified physical-work episodes” (`tier >= 2`) on dataset summary |

Ingest runs after the day film is analysed and after structured actions land.
It never throws into Field Capture upload.

## Rights

`job_only` is the default. The office can still see the operational record
(what happened on this job). Training export of media locators requires
`data_rights = licensable` and `worker_consent = granted`. Widening rights is
an attributed act on the episode row; this Phase 1 does not add a new consent
UI.

## Explicitly not built yet

Decision points, failure/recovery graphs, skill models, crew coordination,
a knowledge graph, and robotics control streams. Actor kind already allows
`human | machine | mixed`. Those layers attach to the same episode id when
they earn a table.

## How a day becomes a record

```text
Field Capture upload
  → job_proofs + episode_observations
  → narration / day analysis (existing)
  → episode_actions (existing)
  → Phase 1 ingest (additive)
       world states · evidence pointers · annotation · immediate outcome
  → office Proof of work
  → training-export when rights allow
```

A Verified Physical-Work Episode is not “hours of video.” It is an episode
that has climbed to Tier 2: before and after (or a day film treated as both),
a location finer than the job, intent, at least one labelled action, and a
verification of any kind. Independent ground truth is still what makes it
worth money.
