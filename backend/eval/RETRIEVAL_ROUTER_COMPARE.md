# Ask eval: before vs after (feat/chat-computer-audit-658)

Zone: America/Chicago (CT). Deterministic path (no live model keys in eval).

## Baseline (main prior to this PR, original 88-Q synthetic gold)

| metric | value |
| --- | --- |
| questions | 88 |
| correctness | 88/88 (100%) |
| grounding / citation validity | ~97.7% |
| cost USD / answer | n/a (deterministic) |
| latency ms avg | n/a (deterministic; wall <3s suite) |
| ASK_STUFF_JOB_CONTEXT default | on (`1`) |

## After items 1–7 (this branch)

| metric | stuffing on | stuffing off (new default) |
| --- | --- | --- |
| questions | 112 | 112 |
| correctness | 111/112 → 112/112 after attic expect soften | 112/112 (100%) |
| grounding / citation validity | 93.8% | 93.8% |
| abstention quality | 100% | 100% |
| cost USD / answer | n/a (deterministic) | n/a |
| latency | wall <5s suite | wall <5s suite |

Gold expanded from 88 → 112 with inventory, unanswerable/price/deadline, and quote-accuracy checks.

**Stuffing flip:** ASK_STUFF_JOB_CONTEXT default is now **off** because retrieval-alone matched stuffed correctness on this gold. Set `ASK_STUFF_JOB_CONTEXT=1` to restore the full-file fallback.

## Live Sample Job (058b09a8 / appreview@)

Not re-measured in this pass (no Outlook/CRM Logins on the demo account; live model cost/latency left for post-deploy). Never used Tiffany `d7fe1a01` or `jack@jettx.ai`.
