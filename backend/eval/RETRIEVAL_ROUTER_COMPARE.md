# Ask eval: before vs after (feat/chat-computer-audit-658)

Zone: America/Chicago (CT). Deterministic path (no live model keys in eval).

## Baseline (prior 88-Q synthetic gold)

| metric | value |
| --- | --- |
| questions | 88 |
| correctness | 88/88 (100%) |
| grounding / citation validity | ~97.7% |
| ASK_STUFF_JOB_CONTEXT default | on (`1`) |

## After items 1–7 (this branch)

| metric | stuffing on (default kept) | stuffing off |
| --- | --- | --- |
| questions | 112 | 112 |
| correctness | 112/112 (100%) | 112/112 (100%) |
| grounding / citation validity | 93.8% | 93.8% |

Gold expanded 88 → 112 (inventory, unanswerable price/deadline, quote-accuracy).

**Stuffing decision:** Retrieval-alone matched stuffed accuracy on synthetic gold, but a multi-turn chat regression (opinion follow-up lost the day label) kept **ASK_STUFF_JOB_CONTEXT default on**. Set `=0` to try retrieval-only in staging.

## Live Sample Job (058b09a8 / appreview@)

Not re-measured here (no Outlook/CRM Logins on demo). Never used Tiffany `d7fe1a01` or `jack@jettx.ai`.
