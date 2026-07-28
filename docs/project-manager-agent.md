# Project Manager Agent

Branch: `claude/project-manager-agent-bdgx8q`

The production side of Atmosphere — what happens after a job is sold. Sales stops
at `won`; this is everything after it.

---

## 1. The problem it exists to solve

A project manager at a restoration company runs fifteen to forty jobs at once.
The work that goes wrong is almost never the work they are currently looking at.
It is:

- the moisture reading nobody took on Tuesday, which means Wednesday's log has a
  hole in it and the carrier can knock the whole dry-out;
- the authorization form nobody chased, which surfaces six weeks later when the
  invoice comes back;
- the dehumidifier still sitting on a job that dried out last Thursday — not
  billable there any more, and not on the next job either;
- the job that has simply gone quiet, which nobody notices because quiet jobs
  don't generate phone calls.

None of that is hard to spot. It is hard to spot *thirty times a day, every day,
without getting bored*. That is the whole thesis of this feature: the agent is
not smarter than the PM, it is just never bored.

---

## 2. Shape

Three layers, and the order matters.

```
   ┌─────────────────────────────────────────────────────────────┐
   │  Data          pm_projects, pm_tasks, pm_drying_areas,      │
   │                pm_moisture_readings, pm_equipment(+…),      │
   │                pm_documents, pm_milestones, pm_assignments  │
   └──────────────────────────────┬──────────────────────────────┘
                                  │  one snapshot, ~11 queries
   ┌──────────────────────────────▼──────────────────────────────┐
   │  Engine        19 pure rules over that snapshot             │
   │                → findings → pm_alerts (deduped)             │
   │                → generated pm_tasks (idempotent)            │
   └──────────────────────────────┬──────────────────────────────┘
                                  │  the same facts
   ┌──────────────────────────────▼──────────────────────────────┐
   │  Writing       morning brief · drafted customer/adjuster    │
   │                updates  (optional — needs an API key)       │
   └─────────────────────────────────────────────────────────────┘
```

**The model never decides what is true.** Every fact the writing layer is shown
was computed by the deterministic engine first. A drying stall is a property of a
reading series; it must not depend on how a paragraph came out. That split is the
single most important design decision here, and everything else follows from it.

---

## 3. What it automates

### On job creation

A new project arrives already carrying:

- its **documentation checklist** — the requirements that apply to *this* trade,
  *this* loss type, and whether it is an insurance claim (`requirements.ts`);
- its **dated commitments** — first contact, carrier initial report, target dry
  date — counted from the **loss date** where one is recorded, because that is
  what a carrier counts from, not from when we heard about it;
- its **first phase of work** from the playbook.

That is most of what "automating as much as possible" means in practice: not
clever inference, but never making somebody type the same fifteen things on every
job.

### Continuously — the rule set

Nineteen rules, all pure functions of one snapshot. Each returns findings; the
engine turns findings into alerts.

| Rule | Fires when |
|---|---|
| `drying_reading_overdue` | An open drying area has not been measured within the org's interval |
| `monitoring_visit_missing` | A drying job has no reading of any kind logged today (in the org's *own* timezone) |
| `drying_stalled` | Moisture has stopped falling for N days, or started rising |
| `drying_under_equipped` | Equipment on site is below the S500 sizing for what is recorded as wet |
| `drying_goal_met` | Every area is at its dry standard — move to sign-off and demobilise |
| `equipment_idle_on_site` | The job dried out N hours ago and units are still placed |
| `tasks_overdue` | Open work past its due date (one alert per project, not per task) |
| `task_blocked` | Somebody stopped on a task and said why |
| `project_no_next_step` | An active project with nothing outstanding — ready to move, or the next step was never written down |
| `project_stale` | No task update, reading, document or equipment movement for N days |
| `project_unassigned` | Active project with no project manager |
| `target_date_at_risk` | Past its target completion date |
| `crew_overloaded` | Somebody over the concurrent-project limit, or allocated past 100% of a day |
| `starting_unstaffed` | A promised start date arrives with no crew assigned |
| `documentation_missing` | A blocking requirement is past the phase it was due by |
| `invoice_blocked` | The job reached billing with a blocking requirement outstanding |
| `milestone_due` | A carrier/permit/customer commitment is due or missed |
| `playbook_gaps` | Standard work for a reached phase never existed (only when auto-creation is off) |
| `customer_update_overdue` | A week-old job with no completed customer contact in seven days |

Thresholds (`reading_interval_hours`, `drying_stall_days`, `stale_project_days`,
`max_projects_per_crew`, …) live in `pm_automation_settings`, per org, because
they are the knobs a shop actually argues about and changing one should not need
a deploy. Any rule can be switched off by key.

### The writing layer (optional)

- **Morning brief** — a short read of where everything stands, per PM.
- **Drafted updates** — customer, adjuster, or team.

Without `ANTHROPIC_API_KEY` the brief still generates, from the same facts, using
a deterministic template. Drafting returns a clear 503. Nothing else changes.

---

## 4. Why the alerts stay trustworthy

An automation that runs on every page load and on a timer is one design mistake
away from being a machine that generates noise. Three things prevent that:

**Stable fingerprints.** Every finding carries a fingerprint identifying *this*
problem on *this* entity — `drying_reading_overdue:<area-id>`, never anything
that changes between runs (no counts, no elapsed hours). `pm_alerts` is unique on
`(org_id, fingerprint)`, so a repeat finding updates one row and bumps
`occurrences` instead of adding a copy.

**Auto-clearing.** A live alert whose finding did not recur this pass is resolved
with `resolution='cleared'`. Without that the list only ever grows and stops
meaning "what is wrong right now". `cleared` is kept distinct from `handled` —
that is how you tell a fixed problem from an ignored one, and the migration's
trigger records no human against a cleared alert, because `auth.uid()` there is
just whoever happened to run the engine.

**Human decisions stick.** Acknowledging an alert does not make it shout again
fifteen minutes later; a snooze wakes on its own; a dismissal is permanent. The
engine's re-run respects all three.

Generated work is idempotent the same way: `pm_tasks` is unique on
`(project_id, origin_key)`. A playbook task the PM cancelled does not grow back,
and one already completed is not re-proposed — which is why the snapshot carries
every `origin_key` ever used, not just the open ones.

---

## 5. Security posture

Identical to the rest of the backend, and worth being explicit about.

- **Everything runs under the caller's JWT.** The engine is not a privileged
  background process — it is code that runs inside somebody's session and sees
  exactly what they can see. If the agent can reach data a human in that seat
  could not, that is a bug.
- **RLS is the boundary, not the route layer.** `store.requireManager()` exists
  to return a clean 403 instead of an opaque refusal; the policies are what
  actually stop anything.
- **Writes split two ways.** *Planning* (projects, assignments, milestones,
  inventory, settings) needs `private.pm_can_manage` — project manager, office
  manager, or the org's creator. *Reporting* (readings, equipment placements,
  drying areas, documents, your own tasks) is open to any member, because the
  person holding the meter is a technician and blocking them pushes the data back
  onto paper.
- **`org_id` is derived, never trusted.** Every child row's `org_id` is
  overwritten from its project by a `BEFORE INSERT` trigger. RLS checks run
  *after* BEFORE triggers, so a caller who names a project in another org is
  checked against *that* org's membership — which they do not have. A default
  would have let a supplied value survive; the overwrite does not.
- **The moisture log is append-only.** No UPDATE or DELETE policy, and no UPDATE
  grant, on `pm_moisture_readings`. A reading log you can quietly revise is not a
  log, and it is the first thing a carrier's auditor stops trusting. A mistaken
  reading is superseded by the next one; `note` is where the correction goes.
- **Nothing is deleted anywhere.** No DELETE grant exists in this schema.
  Projects are cancelled, equipment retired, assignments released, alerts
  resolved. A PM's questions are almost always historical.
- **`private` stays closed.** `anon` and `authenticated` have no USAGE on it.
  Postgres grants EXECUTE on new functions to PUBLIC by default, so opening the
  schema would expose every helper in it — including the billing ones.

### The one exception: the background scheduler

A timer has no session, so a background pass necessarily runs with the
service-role key and RLS bypassed. That trade is worth making only deliberately,
so it takes **two** explicit decisions: `PM_SCHEDULER_ENABLED=true` *and* a
configured `SUPABASE_SERVICE_ROLE_KEY`. With either missing the scheduler does
not start and the agent still works — it evaluates whenever anyone opens the app.
What the background pass buys is the case the on-demand path cannot cover:
catching a missed reading on a day nobody happened to log in.

---

## 6. Guardrails on the writing layer

- **The agent proposes; a human disposes.** Nothing in this codebase sends email
  or SMS. `pm_updates` rows are born `draft` — the RLS policy refuses any other
  status on insert — and marking one `sent` records that a human sent it, it does
  not send it. Editing an approved body is refused by trigger; draft a new one.
- **Untrusted input is delimited data, never instructions.** Customer names,
  adjuster details, technician notes and reading annotations are all
  attacker-reachable in the ordinary course of business — anyone who can take a
  reading can type into `note`. They go into the prompt inside a delimited block,
  and the system prompt says plainly that the block is data.
- **The model is told not to invent.** It is shown facts and asked to order and
  phrase them. Thin data produces a short brief, which is the correct outcome.
- **Everything is traced and metered.** Runs open an `agent_runs` row with
  `agent_key='project_manager'` and append `agent_run_steps`; token usage goes
  through `public.record_usage(… feature => 'pm_brief' | 'pm_update_draft')`,
  which prices against `model_rate_card` and debits credits. Nothing in
  application code hardcodes a price. Both are **best-effort**: a project with the
  `pm_*` schema but not the audit ledger gets a working agent whose runs are not
  traced, rather than a 500.

---

## 7. Layout

```
supabase/
├── migrations/20260727181539_project_manager_agent.sql   13 tables, RLS, triggers
└── tests/                                               18 sections, run.sh
backend/src/pm/
├── types.ts            domain types + the Rule/Finding contract
├── validation.ts       zod schemas
├── store.ts            all data access, under the caller's JWT
├── snapshot.ts         the whole org in ~11 queries
├── psychrometrics.ts   GPP, dew point, S500 sizing, trend + stall detection
├── playbooks.ts        phase → standard work, per trade
├── requirements.ts     documentation + milestone catalogues
├── drying.ts    ┐
├── scheduling.ts├─     analyzers — shared by the rules AND the UI, so the
├── compliance.ts┘      project screen and the alert list cannot disagree
├── health.ts           the score, and why
├── rules.ts            the 19 rules
├── engine.ts           snapshot → findings → alerts → generated work
├── seed.ts             new-project setup
├── ledger.ts           agent_runs tracing + record_usage metering
├── brief.ts            the writing layer
└── scheduler.ts        opt-in background pass
backend/src/routes/pm.ts                                 /api/pm/*
frontend/src/pages/ProjectManagerPage.tsx                the cockpit
frontend/src/pages/PmProjectPage.tsx                     one project
frontend/src/components/pm/primitives.tsx                status/stat/meter/trend
```

---

## 8. API

All under `/api/pm`, all `requireAuth`, all bodies zod-parsed. The router parses
its own JSON at a 256kb limit — a full moisture log for one visit does not fit in
the 10kb global cap.

| Method | Path | Description |
|---|---|---|
| GET | `/overview` | The cockpit: alerts, project health, crew load, counts |
| GET/POST | `/projects` | List / create (creation seeds checklist, milestones, playbook) |
| GET/PATCH | `/projects/:id` | Detail with full analysis / update (phase change re-seeds) |
| POST | `/projects/:id/seed` | Regenerate checklist and playbook |
| POST | `/projects/:id/tasks`, PATCH `/tasks/:id` | Work |
| POST | `/projects/:id/crew`, POST `/crew/:id/release` | Crew |
| GET/POST | `/equipment`, POST `/projects/:id/equipment`, POST `/placements/:id/remove` | Inventory and placement |
| POST | `/projects/:id/areas`, PATCH `/areas/:id` | Drying areas and sign-off |
| POST | `/projects/:id/readings` | Batch readings (GPP derived on the way in) |
| PATCH | `/documents/:id` | Provide / waive a requirement |
| POST/PATCH | `/projects/:id/milestones`, `/milestones/:id` | Dated commitments |
| GET/POST | `/alerts`, `/alerts/:id` | List / acknowledge, snooze, resolve, dismiss |
| POST | `/run` | Evaluate every rule now (optionally one project) |
| GET | `/brief` | The morning brief |
| POST/GET/PATCH | `/projects/:id/updates`, `/updates`, `/updates/:id` | Draft / list / approve |
| GET/PATCH | `/settings`, GET `/rules` | Thresholds and the rule catalogue |

---

## 9. Configuration

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | no | Server-only. Without it the brief falls back to a deterministic template and drafting is disabled. |
| `PM_MODEL` | no | Defaults to `claude-opus-5`. Prices come from `model_rate_card`, never from code. |
| `PM_SCHEDULER_ENABLED` | no | Default `false`. See §5. |
| `PM_SCHEDULER_INTERVAL_MINUTES` | no | Default 30, floor 5. |

---

## 10. Testing

```bash
supabase/tests/run.sh -h /var/run/postgresql -U postgres
```

Applies the migration to a throwaway local Postgres and exercises eighteen
sections of what the schema promises: cross-organization isolation, the role
split between planning and reporting, the append-only reading log, the
manager-only waive, alert de-duplication and identity immutability, equipment
single-placement, lifecycle stamping, and that nothing can be deleted.

Sections whose heading says *expect ERROR* are the guarantees refusing the
operation — an ERROR there is the pass.

Deliberately not run against a Supabase project: it asserts that data cannot be
deleted, so it needs a database it is allowed to throw away.

---

## 11. Decisions worth knowing about

**Self-contained `pm_*` schema.** `claude/agent-memory-system-ggvs3z` defines a
`jobs`/`job_tasks`/`work_logs` model that overlaps with this one. This branch does
not depend on it: it applies against `main` alone. If both land, `pm_projects` and
`jobs` are two names for a similar idea and somebody should reconcile them — that
is a known, deliberate cost of keeping the branches independent.

**Status separate from phase.** `status` is the lifecycle (is anyone working on
this?), `phase` is the position in the workflow. Keeping them apart is what lets
a project be `on_hold` during `drying` without inventing an `on_hold_drying`
state, and gives the playbook one clean key.

**The phase CHECK is the union of both trades.** Which phases are legal for which
work type is enforced in `playbooks.ts`, because that mapping changes far more
often than the database should.

**Timezone is not cosmetic.** "Did anyone take a reading today?" is meaningless in
UTC — a 9pm Eastern visit is tomorrow in UTC, so a naive check reports a missed
day on a job that was visited last night. Every day-boundary question goes through
the org's own zone.

**Money is integer cents.** Never floats, and not the `*_nanos` convention the
credits ledger uses — nanos exist there because per-token prices are sub-cent.
Customer money is cents.

---

## 12. Not built

Named so they don't get smuggled in as if they were:

- **File storage.** `pm_documents.external_ref` is a reference, not a blob.
  Storage buckets are their own design problem.
- **Outbound delivery.** See §6.
- **A calendar.** `scheduled_start_at` plus crew assignments cover scheduling
  until there is a real availability model.
- **Invoicing.** The agent says whether a job *can* be invoiced and what is
  missing. Producing the invoice is somebody else's branch.
- **Lead → project conversion.** `pm_projects.source_lead_id` is deliberately not
  a foreign key, so this branch applies without the Sales one. Wiring the handoff
  is a small job once both exist.
