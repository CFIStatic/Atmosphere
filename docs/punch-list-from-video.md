# Punch list from video analysis

Open items on a job file are **derived only** from analysis already stored on
`job_proofs` (conversation action items / commitments / unresolved questions,
`scopeVerdicts` with `in_progress`, and visible `concerns`). Coverage gaps
(`not_visible`, `cannotTell`) are never turned into punch items. Nothing is
invented.

## Surfaces

- **Job proofs payload** (`GET /api/operations/shared/:jobId/proof`) includes
  `punchList` and `counts.punchList`.
- **Dedicated JSON** (`GET /api/operations/shared/:jobId/punch-list`) with
  `schema: atmosphere.job_punch_list.v1` for proof-pack / PDF consumers.
- **Job file UI** — Punch list panel beside Analysis / disputes; seek timestamps
  and Assign → `job_tasks` (provenance marker `atmosphere.punch:` in details).

## Proof-pack / PDF

The job proof-pack PDF (`GET …/proof-pack.pdf`) includes a **Punch list / open items**
section when items exist (omitted when empty). The same structured list is on
`JobProofPack.punchList` and `GET …/punch-list`.

## Assign

`POST /api/jobs/:id/tasks` via `api.assignPunchListTask` stores a machine line:

`atmosphere.punch:<fingerprint>;seek=<seconds>;proof=<proofId>`

so reloads can mark items Assigned without inventing new tasks.
