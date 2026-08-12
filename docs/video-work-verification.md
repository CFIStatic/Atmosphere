# Video work verification pipeline

## Architecture summary (what already existed)

Atmosphere is **not** a Next.js app. The stack is:

| Layer | Tech |
|-------|------|
| Frontend | Vite + React + React Query |
| Backend | Express BFF (`backend/`) |
| Auth / DB / Storage | Supabase Auth, Postgres (RLS), Storage |
| Existing proof media | `job_proofs` + `job_proof_frames` (device-extracted frames) |
| Existing AI day analysis | `proofAnalyst.ts` (Anthropic) via in-process `RetryQueue` |
| Existing payment gate | Deterministic `proofVerifier.ts` + human accept/reject |
| Evidence portal | `verifier/` static site |

The new pipeline **extends** that media layer. It does not replace the payment-gate proof flow.

### Worker activity vs scope

Proof narration / day analysis / long-form reading follow one rule:

- **Scope attached** → AI reads frames and cross-references agreed `job_scope_items` (per-line verdicts: appears complete / in progress / not in shot).
- **No scope** → AI still reads the frames and dictates what happened (description-only; `scopeCrossRef: false`). Long recordings are no longer skipped when scope is missing.

The deep `/api/verification` frame + LLM stages load the same scope lines into vision/verify prompts when present.

## What this adds

A durable, multi-stage **work verification** pipeline under `backend/src/verification/`:

1. **Ingestion** — signed private uploads, org-scoped paths, validation
2. **Processing orchestration** — `video_processing_jobs` + `video_processing_steps`, idempotent stages
3. **FFmpeg frame extraction** — interval + capped frame count (not every frame)
4. **Quality + dedup** — blur/brightness/motion + perceptual hash (≥80% reduction target)
5. **Scene / room grouping** — sequence + visual boundaries; user corrections allowed
6. **AI analysis** — provider interface (`VisionAnalyzer`); Gemini Flash primary; escalate sparingly
7. **Temporal comparison** — before/after change events (single frame ≠ completed work)
8. **Rules engine** — separate from the model; versioned rules
9. **System confidence** — model confidence is an input, not the verdict
10. **Human review** — append-only decisions; AI rows never overwritten
11. **Reporting API** — job timeline for the frontend
12. **Cost controls** — cache by image+prompt digest, budgets, max frames

## Schema

Migration: `backend/supabase/migrations/20260812090001_video_work_verification.sql`

Key tables: `verification_videos` (optional FK to `job_proofs`), `video_processing_jobs`, `video_processing_steps`, `verification_frames`, `verification_scenes`, `ai_analysis_runs`, `frame_observations`, `temporal_change_events`, `verification_rules`, `verification_results`, `verification_evidence`, `human_review_tasks`, `human_review_decisions`, `verification_audit_events`, `verification_ai_costs`, `verification_usage_limits`.

All org-owned tables use `private.is_org_member(org_id)` RLS. Audit and review decisions are append-only.

## API

Mounted at `/api/verification` (session auth + org context):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/capabilities` | AI readiness (keys present?, FFmpeg?, mock mode) |
| POST | `/videos` | Create upload record + signed URL |
| POST | `/videos/:id/complete` | Finish upload; enqueue pipeline |
| POST | `/videos/:id/reprocess` | Force new processing job |
| GET | `/videos/:id/status` | Video + job + step statuses |
| GET | `/videos/:id/playback-url` | Short-lived signed playback URL |
| GET | `/jobs/:jobId/report` | Timeline + summary by room/status |
| GET | `/results/:resultId` | Result detail + evidence + reviews |
| GET | `/reviews` | Open human review queue |
| POST | `/reviews/:taskId/decisions` | Append a review decision |
| PATCH | `/scenes/:sceneId` | Manual room correction |
| GET | `/usage` | Month AI spend / limits |

Proof uploads also optionally enqueue this pipeline (`VERIFICATION_PIPELINE_FROM_PROOF`, default on) without blocking the existing narration/day-analysis path.

## Processing stages

`validate_video` → `extract_metadata` → `transcode_video` → `extract_frames` → `score_frame_quality` → `deduplicate_frames` → `classify_scenes` → `analyze_frames` → `compare_timeline` → **`llm_verify_evidence`** → `generate_verifications` (legacy fallback) → `generate_verified_events` → `update_project_graph` → `calculate_confidence` → `finalize_report`

**Critical design:** visual observations and temporal candidates are proposals. The **LLM is the primary verifier**. Rules supply a checklist. Humans are exception-only. LLM runs are append-only.

## Additional schema (LLM / ontology / graph)

Migration: `20260812110000_llm_verifier_ontology_graph.sql`

- Work ontology tables (stable activity/state/material IDs)
- `verification_prompts` (versioned)
- `video_clips`
- `llm_verification_runs` (append-only)
- `project_timeline_events` + `workflow_relationships`
- `outcome_records`
- `verification_eval_examples`
- Data-rights columns (`training_consent`, `data_owner`, …)

## Additional APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/jobs/:jobId/timeline` | Structured project timeline |
| GET | `/jobs/:jobId/workflow` | Workflow graph edges |
| POST | `/jobs/:jobId/outcomes` | Link estimate/claim/payment outcomes |
| GET | `/ontology` | Work ontology catalog |

See also `docs/video-work-verification-architecture.md` and
`docs/physical-work-intelligence-architecture.md` (dataset layer / rights / privacy / exports).

## Dataset vertical slice

After LLM verification:

1. `privacy_scan` — flag PII-like text in observations  
2. `evaluate_dataset_eligibility` — rights + privacy + provenance + quality gates  
3. `create_dataset_examples` — only when eligible  

APIs:

- `POST /api/verification/results/:resultId/dataset-example`
- `POST /api/verification/datasets/versions/:versionId/export` (JSONL + checksum)
- `GET /api/verification/datasets/versions/:versionId/examples`

Released dataset versions are immutable. Split assignment is project-grouped to prevent leakage.

## Local development

```bash
# Apply migration (Supabase CLI or SQL editor)
supabase db push
# or run backend/supabase/migrations/20260812090001_video_work_verification.sql

cd backend
cp .env.example .env   # add keys below
npm install

# FFmpeg required for real extraction
sudo apt-get install -y ffmpeg   # or brew install ffmpeg

# Mock AI for local/dev without spend
export VERIFICATION_USE_MOCK_AI=true
export VERIFICATION_ALLOW_MOCK_FALLBACK=true

npm run dev
npm test -- test/verification/pipeline.test.ts
```

### Storage

Use the existing private `job-proofs` bucket (or set `VERIFICATION_STORAGE_BUCKET`). Paths:

`{org_id}/{job_id}/verification/{video_id}/original.mp4`

Never make the bucket public. Clients always use signed URLs.

## Environment variables

See `backend/.env.example` section **Video work verification**. Important:

| Variable | Purpose |
|----------|---------|
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Primary vision model |
| `VERIFICATION_PRIMARY_MODEL` | Default `gemini-2.0-flash` |
| `ANTHROPIC_API_KEY` | Escalation model |
| `VERIFICATION_ESCALATION_MODEL` | Frontier vision model |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Binary locations |
| `VERIFICATION_MAX_FRAMES_PER_VIDEO` | Hard cap (default 120) |
| `VERIFICATION_USE_MOCK_AI` | Force mock analyzer |
| `VERIFICATION_PIPELINE_FROM_PROOF` | Hook proof uploads (`false` to disable) |
| `VERIFICATION_DEFAULT_MONTHLY_BUDGET_USD` | Cost ceiling |

## Deployment (Supabase + Vercel / Node host)

1. Apply the SQL migration to the Supabase project.
2. Confirm `job-proofs` (or configured bucket) is **private**; RLS policies from the migration are enabled.
3. Set server-only secrets on the BFF host (Vercel serverless is a poor fit for FFmpeg + long jobs — prefer a Node service / worker with FFmpeg installed).
4. The current orchestrator uses an in-process `RetryQueue` with **durable DB status**. For multi-instance production, run a single worker process that polls `video_processing_jobs` where `status in ('pending','failed')`, or swap the queue for SQS/Cloud Tasks while keeping the same step table.
5. Keep model API keys server-side only. Never expose raw media publicly.

## Tests

`backend/test/verification/pipeline.test.ts` covers:

- upload validation / safe paths
- quality + dedup reduction
- AI JSON schema validation (mocked)
- temporal comparison
- verification rules
- confidence scoring
- human review schema
- report grouping
- pipeline idempotency + retry

## AI keys + cost-aware routing

Server-only. Never put these in the browser.

The video pipeline routes each task to the **cheapest configured** capable model,
and escalates to a stronger tier only on low confidence, conflicts, or safety flags.

| Key | Role in the route table |
|-----|-------------------------|
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Preferred for **bulk frames** and **bulk verify** (Flash) |
| `OPENAI_API_KEY` | Fast/flagship arms when Gemini is absent or for failover |
| `XAI_API_KEY` | Grok fast/flagship arms |
| `ANTHROPIC_API_KEY` | **Proof narration** + **escalation / dispute** path (accuracy) |

| Task | Default preference (first configured wins) |
|------|--------------------------------------------|
| Bulk frame observation | Gemini Flash → OpenAI mini → Grok mini → Haiku |
| Frame escalation | Sonnet → GPT flagship → Gemini Pro → Grok → Opus |
| Bulk LLM verify | Gemini Flash → OpenAI mini → Grok mini → Haiku → Sonnet |
| Dispute escalate | Sonnet → GPT flagship → Gemini Pro → Grok → Opus |
| Proof narration | Sonnet → Gemini Flash → OpenAI mini → … |

Check readiness + live route table: `GET /api/verification/capabilities`
(Settings → Video AI).

Unset keys no longer silently mock in non-test deploys unless
`VERIFICATION_USE_MOCK_AI=true` or `VERIFICATION_ALLOW_MOCK_FALLBACK=true`.

## Remaining production risks

1. **FFmpeg on serverless** — extract frames on a worker VM/container, not a 10s Vercel function.
2. **In-process queue** — restart-safe via DB status, but needs a poller or external queue for HA.
3. **Heuristic luminance sampler** — replace with a real JPEG decoder (`sharp`) for production blur/brightness fidelity.
4. **Embedding similarity** — schema supports `frame_embeddings`; cosine path is ready, but embedding generation is not wired to a model yet (phash carries dedup today).
5. **CRM lat/lon column names** — existing proof on-site check may still read `lat`/`lon` vs `latitude`/`longitude`; unrelated but affects metadata quality inputs.
6. **Cost** — enforce org budgets in UI; cancel mid-pipeline when exceeded (analyze stage already throws).
7. **Legal hold / retention** — `retain_until` / `deleted_at` exist; a sweeper job is not included.
