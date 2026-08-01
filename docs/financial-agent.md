# Financial Agent

Branch: `cursor/financial-agent-a125`

The books side of Atmosphere — cash position, receivables, job costing, and
read-only connections into the bank and the accounting suite. Built for the
people who run the money: **CEO, CFO, and accountants**.

---

## 1. The problem it exists to solve

A restoration or construction shop already has jobs, contract amounts, invoices,
and labor hours in Atmosphere. The gaps that hurt are almost never "we don't
know how to do accounting." They are:

- cash that moved in the bank overnight and nobody reconciled it to a job;
- AR that aged past 45 days while everyone was looking at the wet wall;
- a job that looks profitable on contract value and is underwater once labor
  and equipment days are counted;
- QuickBooks (or Xero, or Wave) holding the ledger of record while Atmosphere
  holds the job — and nobody has a single picture of both.

The Financial Agent's thesis matches the Project Manager Agent: the work is not
hard to spot once; it is hard to spot *every morning without getting bored*.

---

## 2. Shape

Three layers, same order as the PM agent — and the order is not negotiable.

```
   ┌─────────────────────────────────────────────────────────────┐
   │  Data          finance_connections, finance_accounts,       │
   │                finance_cost_codes, finance_job_costs,       │
   │                finance_alerts, finance_briefs, settings     │
   │                (+ CRM jobs, work_logs, PM equipment rates)  │
   └──────────────────────────────┬──────────────────────────────┘
                                  │  one snapshot
   ┌──────────────────────────────▼──────────────────────────────┐
   │  Engine        pure rules → findings → finance_alerts       │
   │                job-cost rollups (deterministic)             │
   └──────────────────────────────┬──────────────────────────────┘
                                  │  the same facts
   ┌──────────────────────────────▼──────────────────────────────┐
   │  Writing       CFO morning brief (optional LLM)             │
   └─────────────────────────────────────────────────────────────┘
```

**The model never decides what is true.** Aging buckets, margin floors, and
cost overruns are properties of the numbers. The writing layer only narrates.

---

## 3. Who it is for

| Audience | What they need |
|---|---|
| **CEO** | Cash runway, margin by job, alerts that threaten the business |
| **CFO** | AR aging, bank vs books, connection health, the morning brief |
| **Accountant** | Job costing, cost codes, posting drafts, QuickBooks / Intuit sync |

There is no separate `ceo` / `cfo` membership role today. Access is:

- **Read** — any org member (so a PM can see job cost on a job they own).
- **Manage** — `accountant`, `office_manager`, or the org creator
  (`private.can_manage_finance`). That is the CEO/CFO/accountant set in
  practice.

---

## 4. Connections: bank and accounting software

### Posture: observe first

Bank and accounting connections are **read-only by default**. The agent can see
balances, transactions, invoices, and payments. It does **not** move money,
void invoices, or post journal entries without a human approving a draft.

That matches Atmosphere's wider rule: *agent proposes; human disposes*.

### How a connection is made

Three paths, reused from existing Atmosphere machinery:

1. **API connector** (preferred for QuickBooks Online / Intuit, Xero, Wave) —
   OAuth or API key stored as an env credential reference; payloads mirrored
   verbatim through the integrations `Connector` contract.
2. **Web Access** — Claude signs into a bank or desktop-portal UI the shop
   already uses; Verifier confirms what was read.
3. **Computer Use** — paired machine operating QuickBooks Desktop.

`finance_connections` records *which* path is active, the provider, and that
access is read-only. Secrets never live in Postgres — only a `credential_ref`
name, same pattern as CRM integrations.

### Supported providers (v1)

| Provider key | Kind | Notes |
|---|---|---|
| `quickbooks` | accounting | QuickBooks Online / Intuit — first-class connector |
| `xero` | accounting | Config-driven REST against Xero API |
| `wave` | accounting | Config-driven REST |
| `freshbooks` | accounting | Config-driven REST |
| `sage` | accounting | Config-driven REST / CSV |
| `generic_accounting` | accounting | Any online books via REST or CSV export |
| `plaid` / `bank_portal` | bank | Read-only balances & transactions |
| `manual` | either | Spreadsheet / CSV upload when there is no API |

---

## 5. Job costing

A job cost is a line against a CRM job (or PM project), tagged with a cost
code, in **integer cents**:

- labor (from `work_logs.minutes` × burdened rate, or a posted entry)
- materials
- equipment (from PM `daily_rate_cents` × days on site, or a posted entry)
- subcontract
- other

The engine compares cost-to-date against `contract_amount` / `invoiced_amount` /
`paid_amount` on `crm_jobs` and raises alerts when margin floors are breached
or unbilled cost piles up.

---

## 6. Rule set (deterministic)

| Rule | Fires when |
|---|---|
| `ar_aging_critical` | Open AR on a job older than the org's critical days |
| `ar_aging_warn` | Open AR past the warn threshold |
| `job_over_budget` | Job cost ≥ contract × over-budget pct |
| `job_margin_thin` | Remaining margin under the org floor |
| `unbilled_cost` | Cost posted with little or no invoice against it |
| `cash_low` | Connected bank cash below the runway floor |
| `connection_stale` | A finance connection has not synced within the interval |
| `books_out_of_balance` | Bank cash vs books cash diverge beyond tolerance |

Thresholds live in `finance_automation_settings` so a shop can argue about
"45 days" without a deploy.

---

## 7. Audit and metering

- Agent key: `financial_agent`
- Writes to `agent_runs` / `agent_run_steps` via the shared ledger (no forked
  `financial_agent_runs` table)
- Metered through `public.record_usage` with feature `financial_agent` /
  `financial_brief`
- Registered in `backend/src/lib/auditCatalog.ts`

---

## 8. Build order

1. Schema + RLS + `can_manage_finance`
2. Store, snapshot, rules, engine, job-cost rollups
3. QuickBooks / accounting connector stubs + connection CRUD
4. CFO brief (template first; LLM when `ANTHROPIC_API_KEY` is set)
5. `/finance` cockpit UI for CEO / CFO / accountant
6. Wire Web Access / Computer Use as alternate connection paths
7. **Third-party shares / dataroom** — bank-ready packages with frozen report,
   company narrative, org documents, and time-limited links

Everything above Phase 1 is designed so the agent in later phases is a consumer
of the same API surface a human accountant uses — not a parallel code path.

---

## 9. Sharing with banks and other third parties

Accountants (and office managers / org owners) can publish a **financial
dataroom** from `/finance`:

1. Atmosphere freezes a report (cash, AR aging, job cost, backlog, alerts) and a
   **company profile** that explains how the shop works and who does what.
2. Supporting documents (licenses, COI, tax returns, statements, org chart) are
   attached by URL/reference.
3. A time-limited link (`/share/finance/:token`) is minted. The raw token is
   shown once; only its SHA-256 hash is stored. Third parties open it with no
   Atmosphere login.
4. Links expire, can be view-capped, and can be revoked. Revoking the package
   revokes every link under it.

This is the path a restoration company uses when a bank asks for a complete
picture for a loan — without emailing a messy folder of spreadsheets.