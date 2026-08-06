# Physical-work intelligence platform — architecture plan

## 1. Current architecture summary

Atmosphere is an **Express BFF + Vite React + Supabase** application (not Next.js).

| Layer | Current state |
|-------|----------------|
| Auth / tenancy | Supabase Auth, httpOnly cookies, `org_members`, RLS via `private.is_org_member` |
| Domain | `crm_jobs`, `crm_properties`, `job_parties`, `job_locations`, `work_episodes` |
| Proof media | `job_proofs` + frames, private `job-proofs` bucket, signed URLs |
| Verification (this branch) | Durable pipeline under `backend/src/verification/`: FFmpeg frames, quality/dedup, scenes, visual observations, temporal candidates, **LLM verifier**, timeline, workflow graph, human exception review |
| Workers | In-process `RetryQueue` + DB job/step status (not Redis). Heavy media work is designed for a separate worker host |
| AI | Provider registry + Gemini/Anthropic adapters; Zod-validated outputs |
| Deploy | Node BFF; Supabase Postgres/Auth/Storage |

## 2. Reusable components

- Media upload + signed private storage (`ingestion/`)
- Processing orchestrator + idempotent stages
- Frame extraction / quality / dedup / scenes
- `VisionAnalyzer` (observations only)
- `VerificationProvider` / LLM verifier (primary reviewer)
- Ontology tables + versioned prompts
- Timeline + workflow relationships
- Audit append-only events
- Cost / usage limits

## 3. Missing capabilities (this vertical slice addresses)

- Explicit **privacy findings** + export-safe status
- **Rights / eligibility engine** gating dataset admission
- **Operational vs dataset layer** separation
- **Dataset registry** with immutable released versions
- **Canonical dataset examples** with provenance
- **Deterministic splits** (project-grouped)
- **JSONL export** + checksum manifest
- Provenance records linking evidence → verification → example → export

Deferred (schema hooks only / later): full audio pipeline, face redaction models, preference pairs at scale, WebDataset/Parquet exporters, Python CV workers, OpenTelemetry exporters.

## 4. Proposed schema additions

| Area | Tables |
|------|--------|
| Rights | `rights_manifests`, eligibility audit |
| Privacy | `privacy_findings`, `privacy_actions` |
| Provenance | `provenance_records` |
| Dataset layer | `dataset_registry`, `dataset_versions`, `dataset_examples`, `dataset_example_media`, `dataset_splits` |
| Export | `export_jobs`, `export_manifests` |
| Quality | `quality_score_snapshots` |

Operational verification tables remain the product source of truth. Dataset tables only admit rows that pass eligibility.

## 5. Proposed ontology

Reuse `work_ontology_*` (industry → trade → activity / state / material / equipment / damage) with stable IDs. Extend with task/component nodes as needed; core labels never rely on free text alone.

## 6. Proposed processing architecture

Operational path (existing) plus dataset path:

```text
… → llm_verify → timeline/graph
    → privacy_scan
    → rights_eligibility
    → create_dataset_example (if eligible)
    → (optional) export_jsonl
```

Long media work stays async; Vercel/request path only enqueues.

## 7. Proposed verifier architecture

Unchanged principle: observations propose; **LLM verifies** with supporting/contradictory evidence; humans are exceptions; external outcomes reconcile via new records (not silent overwrite).

## 8. Proposed dataset-layer architecture

```text
Verified event + evidence
    → rights + privacy gates
    → canonical example (ontology IDs, provenance)
    → deterministic project-grouped split
    → draft dataset version
    → immutable release + JSONL export + checksums
```

## 9. Implementation sequence (vertical slice first)

1. Migrations for rights/privacy/provenance/dataset/export
2. Eligibility engine + privacy stub
3. Example builder from verified result
4. JSONL exporter + manifest
5. Pipeline stages + API
6. Tests (mocked AI)
7. Docs (no commercial language)

Then expand toward full stage list in later iterations.
