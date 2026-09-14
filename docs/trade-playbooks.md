# Trade playbook library

Org-scoped reusable **checklist / skill cards** built from completed job
analysis. Example: a roofing day that shows tear-off through dry-in becomes a
playbook the crew can open on the next similar job.

## What ships

| Piece | Role |
| --- | --- |
| `trade_playbooks` | Org library row (title, trade, status, source) |
| `trade_playbook_steps` | Ordered checklist / skill-card steps |
| `trade_playbook_sources` | Provenance snapshot of the analysis used to generate |
| `GET/POST /api/playbooks` | List, create, publish, archive |
| `POST /api/playbooks/from-job` | Generate a draft from completed `job_proofs` analysis |
| `/playbooks` | Office library UI |
| **Save as playbook** | On the job file when analysis is done |

## Lifecycle

1. Field Capture uploads and day analysis finish (`analysis_status = done`).
2. Office chooses **Save as playbook** on the job file (or `POST /from-job`).
3. Atmosphere maps `workPerformed`, `scopeVerdicts`, and `concerns` into steps
   (deterministic; no LLM required for v1). Skill keys reuse the episode
   action vocabulary when a verb matches (`remove`, `protect`, `inspect`, …).
4. Draft appears in the org library. Publish when the checklist is ready;
   archive when retired.

## Training corpus foundation

Each generation writes `trade_playbook_sources.analysis_snapshot` with the
summary and lists used to build steps, plus proof ids. That snapshot is the
seed for a later training export — playbooks stay operational checklists first.

## Tenancy

Every row is stamped with `org_id`. Members can read via RLS
(`private.is_org_member`). Writes go through the BFF service role.
