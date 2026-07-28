# Reinforcement learning — how Atmosphere gets better at doing the work

The goal of this branch: **every task the platform executes should be done better
next month than it was this month, without anyone rewriting a prompt.**

Most AI features are static. You pick a model, you write a prompt, you ship it,
and eighteen months later it is doing exactly the same thing at exactly the same
quality — except the world moved, better models shipped, and your users learned
things about their own work that the prompt never heard about. This branch is
the alternative: a closed loop where every job the platform performs produces
evidence, and that evidence changes how the next job is performed.

---

## 1. The core idea

We do not train model weights. We **learn the configuration that executes each
kind of work best**, and we learn it from the work itself.

```
            ┌──────────────────────────────────────────────────────────┐
            │                                                          │
            ▼                                                          │
   ┌─────────────────┐    ┌──────────────┐    ┌──────────────┐   ┌──────────────┐
   │  ASSESS         │───▶│  ROUTE       │───▶│  EXECUTE     │──▶│  VERIFY      │
   │  complexity →   │    │  pick an arm │    │  call the    │   │  + RECORD    │
   │  preferred tier │    │  (model+prompt)│  │  provider    │   │  episode     │
   └─────────────────┘    └──────────────┘    └──────────────┘   └──────┬───────┘
            ▲                                                          │
            │             ┌──────────────┐    ┌──────────────┐         │
            └─────────────│  PROMOTE     │◀───│  HUMAN       │◀────────┘
                          │  gated swap  │    │  accept/edit │
                          └──────────────┘    └──────────────┘
```

Formally this is a **contextual bandit**:

| RL concept | Here |
| ---------- | ---- |
| State / context | Task type, work type, complexity assessment (simple/moderate/complex) |
| Action | An **arm**: `provider × model × prompt variant × parameters` |
| Reward | Scalar in `[0,1]` from verifier + human disposition + cost + latency |
| Policy | Assess complexity → preferred tier; Thompson sampling over Beta posteriors, behind a champion/challenger gate |

### Why a bandit and not fine-tuning or full RL

- **We cannot backpropagate through someone else's API.** Four of our five
  providers are closed. Any method requiring gradients rules out most of the
  models we want to use — including, usually, the best one.
- **Each task is one decision, not a trajectory.** There is no long horizon to
  credit-assign over, so the machinery of full RL buys nothing here.
- **Data is scarce and expensive.** A bandit converges on hundreds of
  observations. Fine-tuning wants tens of thousands, and we would have to
  produce them by doing real work badly first.
- **Decisions must stay explainable.** When a project manager asks "why did it
  write the estimate that way?", the answer is a row in a table: this arm, these
  trials, this posterior, this promotion date. That is not a nice-to-have in a
  business where estimates become contracts.

The action space being the *executor configuration* — rather than the token
stream — is the load-bearing decision of the whole design. It means the platform
improves the moment a better model ships anywhere in the industry, with no
retraining and no migration.

---

## 2. Multi-provider is the mechanism, not a procurement choice

Supporting OpenAI, Anthropic, Google, xAI and open weights is not vendor
hedging. **It is what gives the loop something to learn.** With one model there
is no routing decision to make and the ceiling is fixed at whatever that vendor
happens to be good at this quarter.

With five, three things become true:

1. **Specialisation is discoverable.** Models are genuinely not equally good at
   the same things. One is better at long-document extraction, another at
   arithmetic-heavy estimating, another at warm customer-facing prose. Nobody
   has to guess which is which — the data says so, per task type, and keeps
   saying so as models change underneath us.
2. **Cost collapses without quality doing the same.** A high-volume,
   low-stakes task like summarising job notes does not need a frontier model.
   The loop finds the cheapest arm that still clears the quality bar, and the
   bar is enforced independently of the price (§5).
3. **Vendor risk stops being existential.** A price rise, a deprecation, an
   outage, a quality regression — all of them are just an arm's posterior
   moving. The system reroutes. There is no migration project.

All five sit behind one interface (`src/ai/providers/types.ts`), implemented on
`fetch` rather than five vendor SDKs, so the policy layer never learns a
vendor's name. Three of the five (OpenAI, xAI, and any open-weights server)
speak the same `/chat/completions` dialect and share one adapter; Anthropic and
Google get thin adapters that normalise their envelopes.

**An unset API key removes that vendor's arms and nothing else breaks.** You can
run this with one key, or five.

---

## 3. Context: learning per situation, not on average

The best model for a small mitigation summary is not the best model for a large
construction estimate. But slice context too finely and every slice starves for
data.

So stats are kept at **every level of a hierarchy**, and reads walk from
specific to general, taking the first level with enough evidence to trust:

```
draft_scope:mitigation:large   ← use if it has ≥ AI_MIN_TRIALS_PER_ARM trials
        ↓ else
draft_scope:mitigation
        ↓ else
draft_scope
        ↓ else
tier prior (a weak, capability-based guess)
```

A brand-new slice inherits everything the broader slice already learned and only
specialises once it has earned the right to. Nothing is ever learned twice.

---

## 4. The reward function — the definition of "correct"

`src/ai/reward.ts` is the most consequential file in the branch and should be
read as a policy document. A bandit optimises exactly what is written there,
including the parts nobody meant.

```
reward = w_quality · quality  +  gate · (w_cost · costScore + w_latency · latencyScore)
```

**Quality** blends what a machine can check with what only a human knows:

```
quality = 0.75 · human_disposition  +  0.25 · verifier_score
```

Dispositions: `accepted` 1.0, `edited_minor` 0.75, `edited_major` 0.35,
`rejected` / `failed` 0.0. When we can measure *how much* a user changed, the
measurement (`1 − editRatio`) replaces the coarse bucket — "edited" covers
everything from a typo to a rewrite.

**The gate is the important part.** The obvious failure of any cost-aware router
is that it learns to be cheap instead of right, because cost is measured
perfectly and instantly while quality is measured noisily and late. Two things
prevent it: quality carries 0.6–0.9 of the weight on every task, and the
efficiency terms are **multiplied by a gate that collapses as quality falls
below 0.5**. Cheap-and-wrong scores near zero, not "cheap". There is a test for
exactly this (`learning.test.ts` → *"does not pay the efficiency bonus for fast,
cheap, wrong work"*).

Weights are **per task**, because "correct" genuinely differs:

| Task | quality | cost | latency | Why |
| ---- | ------- | ---- | ------- | --- |
| `estimate_line_items` | 0.90 | 0.05 | 0.05 | A wrong estimate costs more than any model call |
| `extract_document_fields` | 0.90 | 0.05 | 0.05 | Wrong data propagates silently |
| `customer_update_email` | 0.85 | 0.08 | 0.07 | Goes to a customer under our name |
| `draft_scope` | 0.80 | 0.10 | 0.10 | Reviewed before use |
| `classify_moisture_reading` | 0.75 | 0.15 | 0.10 | High frequency, quick to sanity-check |
| `summarize_job_notes` | 0.60 | 0.25 | 0.15 | High volume, read at a glance |

### Two-phase reward

Human feedback is the better signal but it is sparse and slow. Verifier scores
arrive on **every** run in milliseconds. So:

1. **Provisional** — at execution, from the verifier alone, applied at full
   weight and folded into the posteriors immediately. The policy reacts within
   minutes.
2. **Final** — when a human signal lands, the reward is recomputed and the stats
   are updated **by delta**: the provisional contribution is subtracted before
   the final one is added. The correction is exact, not double-counted.

Provisional rewards are applied at full weight rather than discounted, and that
is deliberate. Most runs never get explicit feedback. Discounting them would
make the common case count for less than the rare case, and the policy would end
up tracking the preferences of the small subset of users who click ratings.

---

## 5. Safety rails — why this cannot quietly get worse

A system that changes its own behaviour needs to be *provably* bounded. Five
mechanisms, each guarding a different failure:

| Rail | Guards against |
| ---- | -------------- |
| **Verifier gate** — fatal checks block output from ever being served | A bad experiment reaching a customer |
| **Champion/challenger** — ~90% of traffic on the proven arm | Broad quality regression |
| **Exploration budget** — challengers capped at `AI_CANDIDATE_TRAFFIC_SHARE` | Unbounded blast radius |
| **Promotion gate** — challenger's *lower bound* must beat champion's *mean* | Promotion on a lucky streak |
| **Golden set** — a fixed regression suite, re-run before every promotion | Drift on rare-but-critical cases |

Three of these deserve elaboration.

**Exploration never costs the user a wrong answer.** If an explored arm produces
output that fails a fatal check, the run is still *recorded* — that failure is
real evidence about that arm — and then the champion runs to produce what the
user actually receives. Exploration costs us money and latency. It does not cost
the user correctness.

**Infrastructure noise never becomes a quality signal.** A timeout, a 503, or a
rejected model id fails over to another arm *without recording a reward*.
Otherwise a vendor's bad afternoon would teach the policy to abandon a good
model, and the loop would slowly converge on whoever had the best uptime rather
than the best output. `ProviderError.retryable` is what carries this
distinction, and it is why a Gemini safety block is deliberately classified as
*non*-retryable — that is a real refusal by that arm, not a transport fault.

**Promotion compares a lower bound against a mean.** An arm with a flattering
average over few trials has a wide credible interval and therefore a low bound.
The incumbent gets the benefit of the doubt; the challenger must prove itself.
Tested directly: a 4/5 arm must not out-rank a 61/77 arm.

For **high-stakes tasks** (`estimate_line_items`, `customer_update_email`,
`extract_document_fields`) live exploration is switched off entirely. Challengers
are evaluated in **shadow mode**: run on real production inputs, scored,
recorded, output discarded. Costs a duplicate call, risks nothing, and gives a
far better signal than any static test set — because it is the actual
distribution of work walking through the door. A high-stakes task with no golden
cases defined **cannot** promote at all; silence is not evidence.

---

## 6. Two tiers of learning, two privacy postures

This is the part to get right before any customer data exists.

| Tier | Tables | Contains | Scope |
| ---- | ------ | -------- | ----- |
| **Global** | `ai_arms`, `ai_arm_stats`, `ai_golden_cases` | Aggregate numbers only — *"gpt-5-mini with the structured prompt scores 0.81 on small mitigation summaries"* | Shared across all orgs |
| **Org** | `ai_runs`, `ai_exemplars` | Real job content, customer names, documents | RLS-scoped to one org |

Global stats carry **no customer content whatsoever** — just counts and reward
sums — so every organisation's work improves the routing that every other
organisation benefits from. That is the network effect, and it is safe because
of what is *not* in those tables.

Org-tier data never crosses the boundary, enforced by Row Level Security at the
database layer rather than by application code — the same rule the rest of this
codebase already follows. Every learning write goes through a `SECURITY DEFINER`
function that re-derives the caller from `auth.uid()`, so the API cannot be used
to write a run into someone else's org or to hand-edit the posteriors that drive
routing.

### Exemplars: the org-local half

Global stats can only learn which model is better *on average across every
customer*. **Exemplars** are how the platform learns that *this* company always
itemises drywall by linear foot, or never promises a completion date.

Runs a human accepted (`reward ≥ 0.85`, final reward only) are mined into
few-shot examples and injected into later prompts for that org. No fine-tuning,
no weights, effective on the very next run. Only `final` rewards qualify —
"passed our own checks" is not evidence that a human found it useful, and
exemplars teach house style, which only a human can confirm.

---

## 7. The open-source flywheel

The `oss` arm is not just a cheap option. It is the part that compounds.

Every run through this platform is a **labelled comparison**: the same job,
executed by different models, scored by the same verifier and the same humans.
That is precisely the shape of a preference dataset — and it is produced as a
*by-product of doing the work*. No annotation budget, no labelling vendor.

```bash
npm run learn -- --export estimate_line_items > pairs.jsonl
```

Pairs are matched on `input_digest`, so both sides answered a byte-identical
input, and a margin threshold drops effectively-tied pairs (training on noise
teaches noise). Feed that into DPO/ORPO on an open-weights model and it gets
specifically better at restoration and construction work at a fraction of
frontier inference cost.

Then — and this is the point — **the fine-tune re-enters the pool as an ordinary
candidate arm and has to win on the same evidence as everyone else.** Nothing
about the loop changes to accommodate it. That is the payoff for having made the
action space provider-agnostic in the first place.

The strategic shape: the frontier models teach us what good looks like, the
verifier and our users label it, and an open model we control gradually absorbs
it. Vendor leverage decreases over time instead of increasing.

---

## 8. Data model

| Table | Purpose |
| ----- | ------- |
| `ai_arms` | The action space. One champion per task type, enforced by a unique index |
| `ai_arm_stats` | Beta posteriors per (arm × context level), updated atomically in SQL |
| `ai_runs` | The episode log — every decision, its cost, and how it landed |
| `ai_exemplars` | Mined few-shot examples, org-scoped |
| `ai_golden_cases` | The regression suite that gates promotion |

Write path (all `SECURITY DEFINER`, all validating `auth.uid()` internally):

- `ai_record_run(…)` — insert the episode and fold its provisional reward into
  every level of the context hierarchy, atomically.
- `ai_resolve_run(run_id, disposition, edit_ratio, reward)` — apply human
  feedback and correct the already-counted reward by delta. Idempotent:
  resolving twice replaces the verdict rather than adding an observation.

Concurrency lives in the database (`on conflict do update` on the stats table),
not in application code, so concurrent runs of the same arm cannot lose an
update.

---

## 9. API

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/ai/tasks` | The task catalog and how each is judged |
| POST | `/api/ai/tasks/:taskType/run` | Execute a task. Returns `runId` |
| POST | `/api/ai/runs/:runId/feedback` | Close the loop — disposition or edited text |
| GET | `/api/ai/policy` | Every arm, its posterior, cost and status |
| GET | `/api/ai/runs` | Recent episodes for the caller's org |

The run response deliberately exposes which model produced the output and
whether it was an experiment. A user who can see that gives far better feedback
than one shown an anonymous answer from a black box.

**Feedback is where the loop closes, and the best signal is a by-product.**
Sending `editedOutput` — the text the user actually saved — beats any rating
widget: it arrives for a large share of runs without anyone being nagged, it
cannot be gamed by habit-clicking, and it quantifies *how wrong* rather than
just *whether*.

---

## 10. Running it

```bash
# One-off: apply the schema
psql "$DATABASE_URL" -f db/migrations/0002_reinforcement_learning.sql

# Hot path — nothing to run, learning happens inline on every task

# Offline cycle: evaluate promotions, mine exemplars. Hourly is plenty.
cd backend && npm run learn

# Export training data for an open-weights fine-tune
npm run learn -- --export summarize_job_notes > pairs.jsonl

# Verify the decision logic
npm test
```

The learning cycle needs `SUPABASE_SERVICE_ROLE_KEY` — promotion writes to the
global policy tables, which are intentionally not writable by user JWTs. It runs
golden-set evaluations, which make real model calls, so it stays out of the web
process.

It exits non-zero on partial failure. **A learning loop that has quietly stopped
learning is the worst failure mode this system has, because everything still
looks fine.**

### Recommended rollout

1. Deploy with `AI_EXPLORATION_ENABLED=false`. Every run is still recorded and
   scored — you accumulate evidence with zero behavioural risk.
2. Write golden cases for the high-stakes tasks. Until they exist, those tasks
   cannot promote at all.
3. Turn exploration on at `AI_CANDIDATE_TRAFFIC_SHARE=0.05`. Watch
   `/api/ai/policy` for a week.
4. Raise to 0.1 once promotions are landing and the golden set is holding.

### What to watch

- **Champion posterior trending down** → the world changed under you (a vendor
  regressed, or your input distribution moved). Expected occasionally; the loop
  should recover on its own via promotion.
- **No promotions for weeks** → either the champion is genuinely best, or
  candidates are not getting enough traffic. Check trial counts, not just means.
- **Verifier pass rate falling across all arms** → the problem is upstream of
  the models. Usually a change in input quality.
- **Cost per accepted output** — the number that proves this is working. It
  should fall while quality holds flat.

---

## 11. Known limits and what comes next

Stated plainly, because a system that hides its limits is not trustworthy:

- **The verifier is a proxy for quality, not quality.** It catches malformed,
  ungrounded and arithmetically wrong output. It cannot tell you that a
  perfectly-formed scope missed something a good estimator would have caught.
  That is what the human signal is for, and why it carries 75%.
- **The `no_fabricated_areas` check is a substring heuristic.** It catches
  confident invention, not subtle drift. An LLM judge would be better but
  belongs in the offline path, not on every request — a judge in the reward path
  would launder one model's biases into the score that ranks all of them.
- **No per-org spend caps.** There is a per-IP rate limit on execution; real
  budget enforcement belongs in a billing layer.
- **Exemplar selection is greedy** (top-N by reward). Diversity-aware selection
  would likely do better and is a contained change to `loadExemplars`.
- **Prices are maintained by hand.** They drive only *relative* comparison, so
  uniform drift changes no decision, but a stale entry for one vendor does. The
  catalog notes this and supports overrides without a deploy.
- **No frontend yet.** The API and the policy surface exist; a UI that shows
  users which model wrote a draft and makes feedback a single click is the
  highest-leverage next piece of work, because feedback volume is the binding
  constraint on learning speed.

---

## 12. File map

```
backend/src/ai/
├── types.ts              Domain types — the RL formulation
├── catalog.ts            Model catalog: pricing, tiers, priors
├── assessor.ts           Pre-execution complexity → preferred model tier
├── taskTypes.ts          Task registry: what work is, how it is judged
├── policy.ts             Thompson sampling, context backoff, posteriors
├── reward.ts             The definition of "correct"
├── verifiers.ts          Deterministic checks + the serving gate
├── prompt.ts             Instruction + variant + exemplars
├── executor.ts           assess → route → execute → verify → record, with failover
├── learn.ts              Promotion gate, exemplar mining, preference export
├── store.ts              Persistence under the caller's JWT
├── learning.test.ts      Tests for the decision logic
├── assessor.test.ts      Tests for complexity assessment
└── providers/
    ├── types.ts          The provider interface
    ├── openaiCompatible.ts   OpenAI + xAI + open weights
    ├── anthropic.ts
    ├── google.ts
    └── index.ts          Registry; unset key ⇒ arms excluded

backend/src/routes/ai.ts        HTTP surface
backend/src/scripts/learn.ts    Offline cycle CLI
db/migrations/0002_reinforcement_learning.sql
```
