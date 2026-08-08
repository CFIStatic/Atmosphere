# Architecture: LLM-verified work knowledge graph

## 1. Current architecture (inspected)

Atmosphere is **Express BFF + Vite React + Supabase** (not Next.js).

| Layer | What exists |
|-------|-------------|
| Auth / tenancy | Supabase Auth, httpOnly cookies, `org_members`, RLS via `private.is_org_member` |
| Jobs / property | `crm_jobs`, `crm_properties`, `job_parties`, `job_locations`, `work_episodes` |
| Proof media | `job_proofs` + `job_proof_frames` (device frames), private `job-proofs` bucket |
| Payment gate | Deterministic `proofVerifier.ts` + human accept/reject |
| Day AI | Anthropic `proofAnalyst.ts` via in-process `RetryQueue` |
| Learning AI | Provider registry (`openai` / `anthropic` / `google` / `xai` / `oss`) |
| Verification v1 (this branch) | Durable pipeline under `backend/src/verification/` |

## 2. Reusable components

- `job_proofs` / signed storage / custody log — keep as raw evidence + payment gate
- `job_locations` — room tree for ontology attachment
- `work_episodes` — attach verified events as episode observations later
- `RetryQueue` + `video_processing_jobs/steps` — durable stage runner
- `VisionAnalyzer` — keep for **observations only** (not final verification)
- Human review queue — exception path only
- Cost tracker / usage limits

## 3. Schema additions (this iteration)

| Entity | Role |
|--------|------|
| `work_ontology_*` | Stable IDs for industry/trade/activity/state/material/equipment/damage |
| `verification_prompts` | Versioned production prompts |
| `video_clips` | Short clips around change candidates |
| `llm_verification_runs` | Append-only LLM verifier decisions (primary reviewer) |
| `project_timeline_events` | Structured project timeline |
| `workflow_relationships` | preceded_by / followed_by / verified_by / … |
| `outcome_records` | Link verified work → estimate/claim/payment/complaint/etc. |
| `verification_eval_examples` | Internal evaluation fixtures |
| Data-rights columns on videos / results | Training consent / ownership |

Pipeline stages added: `llm_verify_evidence`, `update_project_graph` (plus `transcode_video` stub, `generate_observations` alias).

## 4. Processing pipeline

```text
Raw video
  → validate / metadata / (optional transcode)
  → extract frames + clips
  → quality + dedup (≥80% reduction)
  → scenes / rooms
  → visual observations (cheap multimodal)     ← evidence only
  → temporal change candidates
  → rules checklist (requirements, not verdict)
  → LLM verifier (primary reviewer)           ← approve / reject / uncertain
  → optional escalation model
  → verified timeline events + workflow edges
  → outcome hooks (when available)
  → exception human review only
```

## 5. LLM verification design

- Observations and change candidates are **proposals**.
- `VerificationProvider.verifyWorkEvent()` receives before/during/after frames, observations, rule checklist, contradictory evidence, project context.
- Output is Zod-validated structured JSON with decision ∈ {verified, likely_verified, partially_verified, uncertain, contradicted, rejected}.
- Skeptical prompt: single-frame presence ≠ proof of contractor action; require same room, sequence, before/after, no contradiction.
- Every run is append-only with prompt version, model, raw + parsed, cost.
- Escalation creates a **new** run, never overwrites the primary.
- Humans are exception-only; their decisions are a separate layer.

## 6. Implementation sequence

1. Migration + ontology seed + prompt versions
2. Types / Zod for LLM verifier output
3. LLM verifier + escalation adapters (mocked in tests)
4. Clip extraction helper
5. Timeline + workflow graph writers
6. Outcome linking API
7. Wire new pipeline stages
8. Reporting endpoints
9. Evaluation fixtures + tests
10. Docs

Then implement.
