# Ask eval: before vs after (feat/ask-retrieval-router-eval)

Zone: America/Chicago (CT). Deterministic path (no live model keys in eval).

## Baseline (main @ 02a0951, original synthetic gold)

| metric | value |
| --- | --- |
| questions | 66 |
| correctness | 66/66 (100%) |
| grounding / citation validity | 100% |
| cost USD / answer | n/a (deterministic) |
| latency ms avg | n/a (deterministic; wall <3s suite) |

Source: `/workspace/chat-routing-shots/baseline-main.json`

## After items 1–7 (this branch, expanded gold)

| metric | value |
| --- | --- |
| questions | 88 |
| correctness | 88/88 (100%) |
| grounding / citation validity | 97.7% |
| cost USD / answer | n/a (deterministic) |
| latency ms avg | n/a (deterministic; wall <3s suite) |

Source: `/workspace/chat-routing-shots/after-all.json`

## Notes

- Gold was expanded with inventory / list / simple-fact job questions (88 total). Flaky brand/dispute extras were pruned.
- Live Opus/Sonnet **cost and latency** were not re-measured on Sample Job / Tiffany in this pass (no new Railway services; prod not deployed). Prior Tiffany metering (~$0.06/q on Opus) remains the pre-router reference; after deploy, re-run Ask on the same 10 questions and diff `token_usage_events` + `ask_route_decisions`.
- Stuffing fallback still **on by default** (`ASK_STUFF_JOB_CONTEXT=1`) until a live-model A/B shows retrieval-alone ≥ stuffed accuracy.
