# Sales Agent — build-out plan

Branch: `claude/sales-agent-m684yp`

This document is the plan of record for the Sales area of Atmosphere. It is written to be
read before any code is written, and to be edited as decisions land. Nothing in here has
been implemented yet.

---

## 1. What we are building

Atmosphere already knows that a member can hold the `sales` role — onboarding offers it with
the blurb *"Estimates, bids, and winning new work."* — but the role currently changes
nothing. A sales user signs in and lands on the same dashboard as everyone else.

The Sales Agent is two layers, built in that order:

1. **The workspace** — the sales rep's actual job, modelled: leads come in, get worked, turn
   into estimates, and are won or lost. This is ordinary CRUD over a new set of RLS-protected
   tables, in the same shape as the existing org/onboarding code.
2. **The agent** — an LLM that operates *on* that workspace: drafts estimates from inspection
   notes, writes follow-ups, summarises a lead's history, flags pipeline that has gone cold.

The order matters and is not negotiable: the agent has nothing to act on until leads and
estimates exist as data. Everything in Phase 1–3 is designed so the agent in Phase 4 is a
consumer of the same API surface a human uses, not a parallel code path.

---

## 2. Ground truth: the database is ahead of the repository

Before planning new schema, a finding that affects how we work on this branch.

The repo contains **no SQL at all** — no `supabase/` directory, no migrations. But the live
Supabase project (`ccxatzfsvzetciiwsjlj`, "Atmosphere") has nine applied migrations and a
substantial amount of schema that **no code in this repository references**:

| Table (public)                    | In repo? | What it is                                                        |
| --------------------------------- | -------- | ----------------------------------------------------------------- |
| `profiles`, `orgs`, `org_members` | used     | Auth + onboarding — the code we have                              |
| `device_credentials`              | used     | PIN sign-in                                                        |
| `web_connections`, `web_credentials`, `web_runs` | **no** | Browser-automation: stored site logins + queued pull/push runs |
| `agent_runs`, `agent_run_steps`   | **no**   | Generic agent audit ledger — run header + ordered step trace       |
| `usage_events`, `usage_daily`, `model_rate_card` | **no** | Token metering + rate card                            |
| `org_billing`, `billing_plans`, `credit_lots`, `credit_ledger`, `credit_packs`, `credit_purchases` | **no** | Credits and billing |

Plus `private.model_costs` and helpers `private.is_org_member`, `private.shares_org`,
`private.can_manage_billing`, `private.price_usage`, and public RPCs `record_usage`,
`quote_usage`, `credit_balance`, `billing_overview`, `set_billing_plan`, …

Two consequences for this branch:

- **We build on this, we do not duplicate it.** The Sales Agent must log to `agent_runs` /
  `agent_run_steps` and meter through `record_usage`. Inventing a `sales_agent_runs` table
  would fork the audit trail and the billing story.
- **Migrations must be checked in from now on.** Right now the schema exists only in the
  hosted project; a fresh clone cannot rebuild this app, and the schema is being changed
  by work outside this repo. Phase 0 addresses this.

> ⚠️ Other sessions appear to be actively applying migrations to the same project. Before
> running any migration from this branch, re-check `supabase_migrations.schema_migrations`
> for versions newer than the ones listed here.

---

## 3. Domain model

The sales motion in restoration and construction, which is what the workspace has to fit:

```
  lead ──▶ contacted ──▶ inspection ──▶ estimating ──▶ proposal sent ──▶ won
                                                                    └──▶ lost
```

A lead in mitigation usually arrives from an insurance carrier or a referral and carries a
claim; a construction lead is more often a homeowner or GC bid. Both are the same pipeline
object with different fields populated, so one `leads` table with nullable insurance columns
beats two tables.

### 3.1 New tables

All in `public`, all with `org_id`, all RLS-enabled, all reached only through the caller's
JWT — identical to the existing pattern.

**`leads`** — one row per opportunity, the pipeline unit.

| Column                                                | Notes                                                   |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `id`, `org_id`, `created_by`, `assigned_to`           | `assigned_to` → `auth.users`, nullable (unassigned)      |
| `status` (`lead_status` enum)                          | `new · contacted · inspecting · estimating · proposed · won · lost` |
| `source` (`lead_source` enum)                          | `referral · insurance · web · phone · canvassing · repeat · other` |
| `work_type` (`work_type` enum)                         | reuses the existing enum                                 |
| `loss_type` (`loss_type` enum, nullable)               | `water · fire · mold · storm · biohazard · remodel · other` |
| `contact_name`, `contact_phone`, `contact_email`       | text, contact_email lowercased                           |
| `address_line1`, `address_line2`, `city`, `region`, `postal_code` | job site                                     |
| `carrier`, `claim_number`, `deductible_cents`          | insurance, nullable                                      |
| `estimated_value_cents` (bigint)                       | rep's gut number before an estimate exists               |
| `next_action_at` (timestamptz, nullable)               | drives the "needs follow-up" view                        |
| `won_at`, `lost_at`, `lost_reason`                     | outcome                                                  |
| `notes` (text)                                         | free-form                                                |
| `created_at`, `updated_at`                             | `updated_at` via `private.touch_updated_at()`            |

**`lead_activities`** — append-only timeline. Every call, text, note, status change, and
agent action lands here. This is what the agent reads to answer "where is this lead?" and
what the UI renders as a history.

| Column | Notes |
| ------ | ----- |
| `id`, `org_id`, `lead_id` | |
| `actor_type` | `user · agent · system` — mirrors `agent_runs.actor_type` |
| `actor_user_id` | nullable |
| `agent_run_id` | nullable FK → `agent_runs.id`; set when the agent authored it |
| `type` | `note · call · sms · email · status_change · appointment · estimate · system` |
| `body` (text ≤ 8000), `payload` (jsonb) | |
| `occurred_at`, `created_at` | |

No UPDATE or DELETE policy — a timeline you can quietly rewrite is not a timeline.

**`estimates`** — a versioned bid against a lead.

| Column | Notes |
| ------ | ----- |
| `id`, `org_id`, `lead_id`, `created_by` | |
| `version` (int) | unique per `(lead_id, version)`; new revision = new row |
| `status` | `draft · sent · accepted · declined · expired` |
| `subtotal_cents`, `tax_cents`, `total_cents` (bigint) | totals maintained by trigger from items |
| `currency` (text, default `USD`) | |
| `valid_until`, `sent_at`, `decided_at` | |
| `origin` | `manual · agent` |
| `agent_run_id` | nullable FK → `agent_runs.id` when drafted by the agent |
| `notes`, `created_at`, `updated_at` | |

**`estimate_items`** — line items.

| Column | Notes |
| ------ | ----- |
| `id`, `org_id`, `estimate_id`, `seq` | `seq` unique per estimate |
| `code` (text, nullable) | price-list code (Xactimate-style) if we ever import one |
| `description` (text) | |
| `quantity` (numeric(12,2)), `unit` (text) | `SF`, `LF`, `EA`, `HR`, `DAY` |
| `unit_price_cents` (bigint), `total_cents` (bigint) | `total_cents` is generated: `round(quantity * unit_price_cents)` |

**Money is stored in integer cents.** Not floats, and not the `*_nanos` convention used by
the credits ledger — nanos exist there because per-token prices are sub-cent. Customer money
is cents.

### 3.2 What we are *not* modelling yet

Deliberately out of scope, listed so they don't get smuggled in:

- **Jobs / production.** Once a lead is `won` it becomes a job — that's the Project Manager's
  area, and a separate branch. Sales stops at `won`.
- **Appointments as a table.** `leads.next_action_at` plus a `type='appointment'` activity
  covers scheduling until we need a real calendar with availability.
- **Documents / photos.** Storage buckets are their own design problem.
- **Outbound email/SMS delivery.** See §6.3 — the agent drafts, a human sends, until we have
  a deliverability story.

### 3.3 RLS

Reads: any member of the org. Writes: sales-capable roles only. Mirroring
`private.can_manage_billing`, add:

```sql
create function private.can_sell(p_org uuid) returns boolean
  language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org and m.user_id = auth.uid()
      and m.role in ('sales','project_manager','office_manager')
  ) or exists (
    select 1 from public.orgs o where o.id = p_org and o.created_by = auth.uid()
  );
$$;
```

Policies then read `using (private.is_org_member(org_id))` for SELECT and
`with check (private.can_sell(org_id))` for INSERT/UPDATE.

> **Consistency note.** The older tables use the `private.is_org_member()` helper; the newer
> `web_*` and `agent_*` tables inline `org_id in (select om.org_id from org_members om where
> om.user_id = auth.uid())`. Both are correct, but the helper is `security definer` and
> avoids recursive-policy surprises. New sales tables use the helper. Converting the
> `web_*`/`agent_*` policies to match is a small, separate cleanup — noted, not scheduled.

---

## 4. Backend surface

New router `backend/src/routes/sales.ts`, mounted at `/api/sales` in `app.ts`, `requireAuth`
applied at the router level exactly like `orgRouter`. Zod schemas go in
`backend/src/lib/validation.ts` beside the existing ones. All Supabase access through
`createUserClient(req.accessToken!)` — RLS stays the source of truth, the service-role key is
not involved.

| Method | Path                              | Body / query                                   | Description                          |
| ------ | --------------------------------- | ---------------------------------------------- | ------------------------------------ |
| GET    | `/api/sales/leads`                | `?status=&assigned=&q=&cursor=&limit=`         | Pipeline list, keyset-paginated      |
| POST   | `/api/sales/leads`                | lead fields                                    | Create a lead                        |
| GET    | `/api/sales/leads/:id`            | —                                              | Lead + activities + estimates        |
| PATCH  | `/api/sales/leads/:id`            | partial lead                                   | Update fields                        |
| POST   | `/api/sales/leads/:id/status`     | `{ status, reason? }`                          | Transition + auto activity           |
| POST   | `/api/sales/leads/:id/activities` | `{ type, body, occurredAt? }`                  | Log a call/note/etc.                 |
| GET    | `/api/sales/estimates/:id`        | —                                              | Estimate + items                     |
| POST   | `/api/sales/leads/:id/estimates`  | `{ items[], notes?, validUntil? }`             | Create a draft estimate (v1, v2, …)  |
| PATCH  | `/api/sales/estimates/:id`        | `{ items?, status?, … }`                       | Edit a draft; `status` transitions   |
| GET    | `/api/sales/summary`              | —                                              | Counts by status, value, stale leads |

Conventions carried over from `org.ts`: snake_case → camelCase at the edge via
`serializeX()` helpers, `HttpError(status, message, code)` for failures, `next(err)` into the
central handler. Note that `express.json({ limit: '10kb' })` in `app.ts` is tight for an
estimate with many line items — Phase 3 raises it for the sales routes specifically rather
than globally.

Frontend client work is additive: new types and methods in `frontend/src/lib/api.ts`
following the existing `api.*` object style.

---

## 5. Frontend

Routing today is flat — `/login`, `/onboarding`, `/dashboard`. Sales adds a nested area,
which means the first real navigation chrome in the app.

- `/sales` — **Pipeline.** Board grouped by status (or a table on narrow screens), each card
  showing contact, address, value, age, next action. Filter by assignee and status.
- `/sales/leads/:id` — **Lead detail.** Header with status control, contact and claim panels,
  the activity timeline, and the estimates list.
- `/sales/leads/:id/estimates/:eid` — **Estimate editor.** Line-item table with running
  totals, draft → sent transition.
- Dashboard gets a **Sales** entry, shown to everyone but highlighted for `role === 'sales'`.

Guarding: a `RequireRole` wrapper alongside the existing `RequireOnboarded` in `App.tsx`.
It is UX only — the RLS policies in §3.3 are the actual boundary, and the wrapper must never
be the only thing standing between a user and data.

Visual language is already established (`cx-aurora`, `ink-*`/`brand-*` Tailwind scale,
`rounded-xl border border-white/10 bg-ink-800/60 backdrop-blur` cards, `animate-fade-in-up`).
Sales screens reuse it as-is; no new design system.

---

## 6. The agent layer (Phase 4)

### 6.1 Shape

A tool-using loop on the backend, reachable at `POST /api/sales/agent` (SSE stream) with the
conversation scoped to an optional `leadId`. The model gets tools that are **thin wrappers
over the same service functions the HTTP routes call** — so the agent cannot reach data a
human in that seat could not, and RLS applies to the agent exactly as it does to the user
whose JWT is in play.

Proposed tools:

| Tool                 | Effect                                                     |
| -------------------- | ---------------------------------------------------------- |
| `search_leads`       | read: filter/sort the pipeline                              |
| `get_lead`           | read: one lead with its timeline and estimates              |
| `log_activity`       | write: append a note to the timeline                        |
| `update_lead`        | write: fields + status (guarded — see §6.3)                 |
| `draft_estimate`     | write: create a **draft** estimate with line items          |
| `schedule_followup`  | write: set `next_action_at`                                 |

`draft_estimate` is the highest-value one: a rep dictates inspection notes, the agent
produces a structured line-item bid the rep edits. It writes `status='draft'`,
`origin='agent'`, and never `sent`.

### 6.2 Observability and billing — reuse, don't rebuild

Both already exist in the database and must be used:

- **Every agent turn opens an `agent_runs` row** with `agent_key='sales_agent'`,
  `source_table='leads'`, `source_id=<lead id>`, `actor_type='user'`,
  `actor_user_id=<caller>`. Each tool call and result appends an `agent_run_steps` row
  (`type` ∈ `tool_call`, `tool_result`, `message`, `error`, …). The `agent_runs_guard`
  trigger already enforces that identity columns are immutable, a terminal status cannot be
  rewritten, and counters only climb — so the trace is trustworthy by construction, and the
  code just has to write to it honestly.
- **Every model response calls `public.record_usage(org, model_id, request_id, …, feature =>
  'sales_agent')`**, which prices against `private.model_costs` and debits credits. Before
  starting a run, check `public.credit_balance(org)` and refuse with a clear error rather
  than running up a bill that cannot be paid.

Model selection comes from `public.model_rate_card`, which is already seeded and branded:
`claude-sonnet-5` ("Atmosphere Core") is the default for drafting and chat;
`claude-opus-5` ("Atmosphere Pro") for the harder estimate synthesis;
`claude-haiku-4-5` ("Atmosphere Lite") for summarisation and classification. Do not hardcode
prices anywhere in application code — the rate card is the source of truth.

`ANTHROPIC_API_KEY` is a **server-only secret**, added to `config.ts` in the same style as
`SUPABASE_SERVICE_ROLE_KEY`: optional, and when unset the agent surface is simply hidden and
the workspace works unchanged. Before writing the integration, load the `claude-api` skill
for current SDK/model/caching specifics rather than working from memory.

### 6.3 Guardrails

- **The agent proposes; a human disposes.** No outbound customer communication is sent by the
  agent. Estimates are created as drafts. Marking a lead `won`/`lost` stays a human action.
- **Lead notes, emails, and anything scraped by `web_runs` are untrusted input.** They are
  attacker-controllable (anyone who can submit a web-form lead can write into them). They go
  into the prompt as clearly delimited data, never as instructions, and the tool layer — not
  the model's judgement — enforces what is writable.
- **Everything the agent did is inspectable.** The lead timeline shows agent-authored entries
  as such, linked to their `agent_run_id`, and a run detail view renders the step trace.

### 6.4 Later: pulling leads in

`web_connections` / `web_runs` already model authenticated browser automation against an
external site. Carrier and lead-vendor portals are the obvious use: a `kind='pull'` run that
logs into a portal and returns new assignments, which land as `leads` with
`source='insurance'`. This is real value but it depends on a working workspace and on the
web-automation layer having application code at all — it is explicitly after Phase 4.

---

## 7. Phasing

Each phase is independently shippable and ends in a state where the app runs.

| Phase | Deliverable | Done when |
| ----- | ----------- | --------- |
| **0** | `supabase/migrations/` in-repo; existing hosted schema captured as a baseline migration; README note on migration workflow | A fresh clone can rebuild the schema |
| **1** | `leads` + `lead_activities` + `lead_status`/`lead_source`/`loss_type` enums + `private.can_sell` + RLS | A sales user can be granted/denied at the DB layer; policies tested from two orgs |
| **2** | `/api/sales/leads*` routes, zod schemas, api client, Pipeline + Lead detail screens | A rep can create a lead, work it through every status, and log activity |
| **3** | `estimates` + `estimate_items` + routes + estimate editor | A rep can build a multi-line estimate, revise it, and mark it sent/accepted |
| **4** | Agent loop, tools, SSE endpoint, `agent_runs` tracing, `record_usage` metering, chat + run-trace UI | Agent drafts an estimate from notes; the run is fully traced and billed |
| **5** | *(optional)* Lead ingestion via `web_runs` | Leads appear from a connected portal |

Phase 0 first is not bureaucracy: Phase 1 adds enums and tables to a project other sessions
are concurrently migrating, and without checked-in migrations there is no way to know what
we're building on or to reproduce it.

---

## 8. Open decisions

These need answers before the phase in brackets starts. None block Phase 0.

1. **Lead visibility** [1] — can every org member see every lead, or only the assignee plus
   managers? The plan above assumes org-wide read, which is simpler and matches the
   "everyone linked can see and communicate" framing in the README. Commission-sensitive
   shops often want per-rep isolation; changing it later is an RLS change, not a rewrite.
2. **Price list** [3] — do we ship a starter line-item catalogue (common water-mitigation
   tasks with units), or is every estimate typed from scratch? A catalogue makes the agent's
   drafts dramatically better because it can pick codes instead of inventing descriptions.
3. **Who pays for agent runs** [4] — credits are org-level. Do we cap per-user or per-feature
   spend for `sales_agent`? `org_billing.monthly_spend_limit` exists but is org-wide.
4. **Estimate output** [3] — does "sent" mean a PDF? That pulls in document generation and
   storage. Interim: a shareable read-only web view.
5. **The `web_*` and `agent_*` tables have no application code at all** — is that work landing
   in this repo, or another? If another, Phase 4's tracing needs to agree with whatever is
   writing those tables today.

---

## 9. Working agreement for this branch

- Every schema change ships as a checked-in migration in `supabase/migrations/`, applied via
  `apply_migration`, never as a bare `execute_sql`.
- No service-role key in data paths. Sales data is read and written under the caller's JWT.
- Route → zod → service → Supabase, matching `org.ts`. Serialization to camelCase at the
  edge.
- The agent uses the same service layer as the HTTP routes. If the agent can do something a
  user cannot, that is a bug.
- README gets a Sales section as each phase lands, matching the existing depth.
