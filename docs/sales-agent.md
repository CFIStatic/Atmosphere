# Atmosphere internal outreach pipeline

Branch: `cursor/atmosphere-internal-outreach-pipeline-3097`

Forked from the outbound Sales Agent (`cursor/sales-agent-outbound-18e2`) and
**retargeted solely for Atmosphere's own GTM**. This is not a tenant product for
customer sales teams — it is our internal machine for marketing Atmosphere,
finding restoration/construction buyers, automating outreach, and booking
**product demos** so salespeople can spend the day closing.

Left-nav label: **Outreach** (Internal).

---

## 1. Goal

Automate the top of Atmosphere's funnel so human reps live in demos and closes:

```
territory + Atmosphere ICP
  → research restoration / mitigation / rebuild companies
  → crawl public pages for owners & ops decision-makers
  → personalise Atmosphere product outreach
  → follow up until they reply
  → book a product demo (estimators, web access, field tools, audit trail)
  → salesperson closes
```

Defaults pitch **Atmosphere** (value prop, sender org, demo CTA). Campaigns can
override ICP focus or pitch copy, but empty fields fall back to product defaults
in `backend/src/sales/atmosphereProduct.ts`.

---

## 2. Data model

Same schema as the outbound Sales Agent (org-scoped, RLS via
`private.is_org_member` / `private.can_sell`):

| Table | Purpose |
| ----- | ------- |
| `sales_campaigns` | Territory, ICP focus, Atmosphere pitch, sender, availability |
| `sales_businesses` | Buyer companies found in the territory |
| `sales_contacts` | Decision-makers with research hooks |
| `sales_outreach` | Outbound + inbound email trail |
| `sales_meetings` | Booked **product demos** + ICS |
| `sales_events` | Campaign timeline |
| `sales_people_searches` | NL people-search history |

Migrations: `supabase/migrations/20260728140000_sales_agent.sql`,
`…_sales_people_search.sql`.

Campaign statuses: `draft → researching → crawling → outreach → following_up → scheduling → completed` (plus `paused` / `failed`).

---

## 3. Backend surface

Router: `backend/src/routes/sales.ts` at `/api/sales` (unchanged paths).

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/sales/status` | Capabilities (LLM, crawl, email, demo) |
| GET/POST | `/api/sales/campaigns` | List / create (Atmosphere defaults applied) |
| GET | `/api/sales/campaigns/:id` | Detail + counts |
| PATCH | `/api/sales/campaigns/:id` | Update draft settings |
| POST | `/api/sales/campaigns/:id/start` | Kick the agent |
| POST | `/api/sales/campaigns/:id/pause` | Pause |
| POST | `/api/sales/campaigns/:id/resume` | Resume follow-ups |
| GET | `/api/sales/campaigns/:id/businesses` | Buyer companies |
| GET | `/api/sales/campaigns/:id/contacts` | Decision-makers |
| GET | `/api/sales/campaigns/:id/outreach` | Email trail |
| GET | `/api/sales/campaigns/:id/meetings` | Booked demos |
| GET | `/api/sales/campaigns/:id/events` | Timeline |
| POST | `/api/sales/outreach/:id/reply` | Record / simulate an inbound reply |
| POST | `/api/sales/meetings/:id/confirm` | Human confirm (optional) |
| POST/GET | `/api/sales/people-search` | NL buyer lookup |

Orchestration: `backend/src/sales/` (`atmosphereProduct`, `research`, `crawl`,
`email`, `schedule`, `runner`, `peopleSearch`).

---

## 4. How each stage works

### Research
Geocode the territory, query Overpass with **restoration/construction-first**
filters (mitigation, rebuild GC, trade offices), enrich with Claude when
`ANTHROPIC_API_KEY` is set. Demo seed list is restoration buyers (water, fire,
mold, rebuild, disaster services, estimating groups).

### Crawl
Playwright fetches public website pages and extracts emails, names, titles.
Prefers owners / ops / estimator leads (`ICP_BUYER_TITLES`).

### Outreach
Drafts short emails that **pitch Atmosphere** and CTA a product demo. Resend when
`RESEND_API_KEY` is set; otherwise `simulated`. Follow-ups on day 3 / 7 / 14.

### Demo scheduling
Positive reply → next free slot from campaign availability → `sales_meetings`
row titled `Atmosphere product demo — {company}` → confirmation email + ICS.

---

## 5. Frontend

- Left-hand primary nav: **Outreach** (`AppShell`).
- `/sales` — workspace:
  - **Find people** — NL lookup tuned for restoration buyers
  - **Campaigns** — territory Atmosphere outreach pipeline
- `/sales/:id` — campaign detail (businesses, contacts, outreach, demos, events)

ICP focus, Atmosphere pitch, and sender name are prefilled for new campaigns.

---

## 6. Guardrails

- Outbound email requires a configured sender and respects a per-org rate limit.
- Contacts marked unsubscribed are never emailed again.
- Lead/website text is untrusted input — delimited in prompts, never executed.
- Demos only book inside the human-configured availability window.
- Audit: every campaign run writes `agent_runs` with `agent_key='sales_agent'`
  (catalog name: **Atmosphere Outreach**).

---

## 7. Config

| Env | Purpose |
| --- | ------- |
| `ANTHROPIC_API_KEY` | Personalisation + reply classification |
| `RESEND_API_KEY` | Real email send (optional) |
| `SALES_FROM_EMAIL` | Default From address |
| `SALES_DEMO_MODE` | Force demo discovery (`true`/`false`; auto when offline) |

---

## 8. Relationship to other branches

| Branch | Role |
| ------ | ---- |
| `cursor/sales-agent-outbound-18e2` | Generic outbound Sales Agent this fork started from |
| `cursor/email-marketing-9ac4` | Storm email marketing for *tenant* books of business |
| This branch | Atmosphere-only GTM outreach + demo booking |
