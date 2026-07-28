# Audit — recording an agent's work

Everything the Audit tab shows comes from two tables, `agent_runs` and `agent_run_steps`
(`db/audit_ledger.sql`). This is how work gets into them.

## Install

```bash
psql "$DATABASE_URL" -f db/audit_ledger.sql
```

Idempotent — re-running it is safe. It creates the tables, the RLS policies, the integrity
triggers, the rollup functions the tab reads, and installs a bridge for every source table
that exists at that moment.

## The two intakes

An agent's work reaches the ledger one of two ways, and which one applies is a property of
the agent, not a choice made per run.

### 1. The agent writes its own trace

For agents that run inside the backend process. Three calls:

```ts
import { auditWriter, startRun, recordStep, finishRun, resolveOrgId } from '../lib/auditLog.js';

const audit = auditWriter(accessToken);          // omit the token for unattended work
const run = await startRun(audit, {
  orgId,
  agentKey: 'computer_use',                      // must exist in lib/auditCatalog.ts
  agentLabel: machine.name,                      // what it was pointed at
  title: instruction,                            // what it was asked to do
  actorUserId: user.id,
  input: { model: model.id, quality },
});

await recordStep(audit, run.data!.id, {
  type: 'tool_call',
  action: 'click',
  detail: 'Clicked the QuickBooks icon in the dock',
  target: 'point(412, 1042)',
  durationMs: 180,
  payload: { coordinate: [412, 1042] },
});

await finishRun(audit, run.data!.id, {
  status: 'succeeded',
  result: { reconciled: 42 },
  inputTokens: usage.inputTokens,               // absolute totals, not deltas
  outputTokens: usage.outputTokens,
});
```

Nothing here throws. A failed audit write logs and returns `{ ok: false }` — recording work
must never break the work being recorded, because a gap in the trail is visible and
recoverable while an outage is neither. Callers that want to know may check `ok`.

Agents that run **outside** this process use the same shape over HTTP:
`POST /api/audit/runs`, `POST /api/audit/runs/:id/steps`, `PATCH /api/audit/runs/:id`. The
org is taken from the caller's session, never from the body.

### 2. The agent is mirrored from its own table

For agents that already persist runs. A trigger copies each write into the ledger, so no
agent code changes and the mirror cannot drift from the source. Three bridges ship:

| Source table        | Agent          | Becomes                                            |
| ------------------- | -------------- | -------------------------------------------------- |
| `web_runs`          | `web_access`   | One run; its `steps` jsonb array expands to steps.  |
| `crm_sync_runs`     | `crm_sync`     | One run; its record counters become one step.       |
| `backup_snapshots`  | `backup`       | One run; `backup_snapshot_items` become its steps.  |

Bridges install only for tables that exist. Atmosphere's agents ship on separate branches,
so after one merges, pick up its table with:

```sql
select public.audit_install_bridges();
-- installed: web_runs, crm_sync_runs; not present yet: backup_snapshots
```

Every bridge swallows its own errors and logs a warning: a broken bridge degrades to silence
rather than failing the write it was watching.

## Adding a new agent

1. Add it to `AGENT_CATALOG` in `backend/src/lib/auditCatalog.ts` — key, name, blurb, accent.
   The tab lists catalog agents even with zero runs, so "this agent has done nothing" is
   distinguishable from "this agent is not being audited".
2. Either call `lib/auditLog.ts` from the agent, or add a bridge function and a branch in
   `public.audit_install_bridges()`.

An agent that ships ahead of its catalog entry still records and still displays — the key is
title-cased for the name. Similarly, a step whose `type` the schema does not know is stored as
`event` rather than rejected. Losing a step is the one outcome an audit trail cannot afford.

## Step types

Pick the one that says what the agent actually did; the tab gives each its own glyph so a long
trace can be skimmed by shape.

| Type | For |
| ---- | --- |
| `status` | Run-level milestones — accepted, stopped, retrying. |
| `thought` | The agent's reasoning before it acts. |
| `message` | Something said to or by a person. |
| `tool_call` | An action taken on the world: click, type, request, query. |
| `tool_result` | What that action returned. |
| `observation` | Something noticed without acting — a wait, a poll, a read. |
| `navigation` | Moving to a new page, screen, or context. |
| `decision` | A branch taken, and why the other was not. |
| `artifact` | Something produced: a file, an archive, an export. |
| `usage` | Token or cost accounting. |
| `error` | Something went wrong. Also set `status: 'error'`. |
| `event` | Anything else, and the fallback for unknown types. |

## What not to put in a step

`lib/auditLog.ts` redacts before writing, but the cheapest secret to protect is one that was
never passed:

- **Credentials.** Keys matching `pass|secret|token|credential|authorization|api_key|pin|ssn|
  cvv|card_number|private_key` are replaced with `[redacted]`. Redaction is by key name, so a
  password under a key called `value` still gets through.
- **Images.** Screenshot bytes and `data:` URLs are replaced with a size descriptor. The
  ledger is a record of what happened, not a PNG store.
- **Bulk data.** Payloads are capped at 16 KB, strings at 2,000 characters, arrays at 50
  items, nesting at 6 deep. Past the payload cap the whole payload becomes a note saying so.

## Reading it back

`GET /api/audit/runs` is keyset-paged on `<created_at>|<id>`, not offset-paged: the ledger is
appended to constantly, and with OFFSET a run inserted mid-scroll shifts every later page by
one and the reader silently skips a row.

`GET /api/audit/runs/:id?afterSeq=N` returns only steps past `N`, which is how the tab tails a
running agent at constant cost however long the run gets.
