# Ask gold eval + release gate

This eval checks what clip Ask answers and what clip summaries say against a gold set. CI fails a change if either of these is non-zero:

- **Critical assertions:** a work-completed, price or commitment claim that the evidence does not support. This includes the answer-quality `unsupported_claim` checks and any gold `critical` phrase.
- **Summary-transcript contradictions:** checked two ways.
  - The summary as Ask and the player would show it (a stale or contradicting summary is dropped).
  - A freshly generated summary after the pipeline's validate → regenerate → quarantine path (`publishableConversation`).

An answer that states a speech count the transcript contradicts also fails the gate.

Reported metrics:

- correctness
- relevance (no off-topic answer, no whole-transcript dump)
- grounding (quoted spans exist in the evidence)
- timestamp accuracy (±1 s)
- unsupported-claim rate
- abstention quality
- contradiction rate
- per-question-type correctness

## Run

```bash
cd backend
npm run eval:ask                                  # synthetic gold (this folder), deterministic
EVAL_GOLD_PATH=/private/gold.json npm run eval:ask
EVAL_GOLD_URL=https://… EVAL_GOLD_TOKEN=… npm run eval:ask
EVAL_WITH_MODEL=1 ANTHROPIC_API_KEY=… npm run eval:ask   # score the model path too
EVAL_CLIPASK_MODULE=../other-checkout/backend/src/shared/clipAsk.ts npm run eval:ask   # A/B against another checkout
EVAL_REPORT_PATH=/tmp/report.json …               # full JSON report
EVAL_MIN_CORRECTNESS=0.9 …                        # optional correctness floor
```

## Gold data

This repo is public. **Only synthetic gold is committed** (`synthetic-gold.json`). Real clips must be consented and are kept outside the repo. They are loaded at run time through `EVAL_GOLD_PATH` or `EVAL_GOLD_URL`, which is the CI secret; `EVAL_GOLD_TOKEN` is sent as a bearer token.

When private gold is used, the printed report and the GitHub step summary are redacted: no clip text and short clip ids only. Never upload the JSON report as an artifact for private gold.

Schema: `src/eval/goldTypes.ts`. Each clip carries:

- `categories`: walkthrough, quiet, multiple_voices, media_playback, damage_closeup, occlusion, no_work.
- `consent`: `pending` | `confirmed` | `declined`. Declined clips are skipped.
- `record`: what Ask sees, i.e. `clipRecordFromEvidenceItem` output.
- 6–10 `questions`. Each question has one of these types:
  - `transcript_count`
  - `quote_time`
  - `temporal_order`
  - `negative`
  - `false_premise`
  - `speaker_source`

  Each question also has an `expect` block with:
  - `answerType`: `answer` | `abstain`
  - `count`
  - `quotes` (with `at` seconds)
  - `order`
  - `yesNo`
  - `mustContain` / `mustNotContain`
  - `critical`

Questions drafted automatically carry `needsReview: true` until a person confirms them.

## CI

The gate workflow is at `eval/ci/ask-eval.yml`. Copy it to `.github/workflows/ask-eval.yml` to turn it on. The PR's push token could not write workflow files.

To make it block releases, mark the **Ask eval gate** check as required on `main` in branch protection. For the private run, add the `EVAL_GOLD_URL` secret (plus `EVAL_GOLD_TOKEN` if needed). To score the model path too, add the `EVAL_WITH_MODEL=1` variable and the `ANTHROPIC_API_KEY` secret.
