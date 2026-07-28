# Sales Agent — outbound prospecting

Branch: `cursor/sales-agent-outbound-18e2`

The Sales Agent sits on a **left-nav tab** in Atmosphere. A rep names a
**territory** and a **sales focus**; the agent then researches businesses in
that area, crawls public pages for decision-makers, personalises outreach,
keeps emailing until someone answers, and books an in-person meeting.

This is outbound prospecting — not the earlier CRM-estimate plan.

---

## 1. What we are building

Flow the agent owns end-to-end:

```
territory + focus
  → research businesses in the area (Overpass/Nominatim + optional LLM)
  → crawl public websites / about / contact pages for decision-makers
  → research each person (hooks for personalisation)
  → send a personalised email
  → follow up on a cadence until they reply
  → classify the reply and schedule a meeting autonomously
```

The human's job is to set the campaign (territory, focus, value prop, sender
identity, availability) and supervise. The agent does the research and the
outreach loop.

---

## 2. Data model

All tables in `public`, org-scoped, RLS via `private.is_org_member` /
`private.can_sell`. Migration: `supabase/migrations/20260728140000_sales_agent.sql`.

| Table | Purpose |
| ----- | ------- |
| `sales_campaigns` | Territory, focus, sender, availability, pipeline status |
| `sales_businesses` | Businesses found in the territory |
| `sales_contacts` | Decision-makers with research hooks |
| `sales_outreach` | Outbound + inbound email trail |
| `sales_meetings` | Proposed / confirmed meetings + ICS |
| `sales_events` | Campaign timeline |

Campaign statuses: `draft → researching → crawling → outreach → following_up → scheduling → completed` (plus `paused` / `failed`).

---

## 3. Backend surface

Router: `backend/src/routes/sales.ts` mounted at `/api/sales`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/sales/status` | Capabilities (LLM, crawl, email, demo) |
| GET/POST | `/api/sales/campaigns` | List / create |
| GET | `/api/sales/campaigns/:id` | Detail + counts |
| PATCH | `/api/sales/campaigns/:id` | Update draft settings |
| POST | `/api/sales/campaigns/:id/start` | Kick the agent |
| POST | `/api/sales/campaigns/:id/pause` | Pause |
| POST | `/api/sales/campaigns/:id/resume` | Resume follow-ups |
| GET | `/api/sales/campaigns/:id/businesses` | Pipeline businesses |
| GET | `/api/sales/campaigns/:id/contacts` | Decision-makers |
| GET | `/api/sales/campaigns/:id/outreach` | Email trail |
| GET | `/api/sales/campaigns/:id/meetings` | Booked meetings |
| GET | `/api/sales/campaigns/:id/events` | Timeline |
| POST | `/api/sales/outreach/:id/reply` | Record / simulate an inbound reply |
| POST | `/api/sales/meetings/:id/confirm` | Human confirm (optional) |

Orchestration lives in `backend/src/sales/` (`research`, `crawl`, `email`, `schedule`, `runner`).

---

## 4. How each stage works

### Research
Geocode the territory with Nominatim, query Overpass for amenity/shop nodes
matching the sales focus, and enrich with an LLM when `ANTHROPIC_API_KEY` is
set. Without external reach, a deterministic **demo** seed list still fills the
pipeline so the UI is exercisable.

### Crawl
Playwright fetches the business website (home, `/about`, `/contact`, `/team`)
and extracts emails, names, and titles. URL guardrails from Web Access apply —
only `http(s)` public pages, no credential stuffing.

### Outreach
The agent drafts a short personalised email from research hooks. Delivery uses
Resend when `RESEND_API_KEY` is set; otherwise messages are stored as
`simulated` so the rest of the loop can be tested. Follow-ups fire on
`next_followup_at` (day 3, day 7, day 14 by default).

### Scheduling
When a reply is classified as interested, the agent picks the next free slot
from the campaign's `availability`, writes a `sales_meetings` row, emails a
confirmation + ICS, and marks the contact `meeting_booked`.

---

## 5. Frontend

- Left-hand primary nav includes **Sales Agent** (`AppShell`).
- `/sales` — campaign workspace: left rail for setup / agent status, main pane
  for businesses, contacts, outreach, and meetings.
- `/sales/:id` — deep link into one campaign.

---

## 6. Guardrails

- Outbound email requires a configured sender and respects a per-org rate limit.
- Contacts can be marked unsubscribed; the agent never emails them again.
- Lead/website text is untrusted input — delimited in prompts, never executed.
- The agent proposes and books meetings only inside the availability window the
  human configured.
- Audit: every campaign run writes `agent_runs` with `agent_key='sales_agent'`.

---

## 7. Config

| Env | Purpose |
| --- | ------- |
| `ANTHROPIC_API_KEY` | Personalisation + reply classification |
| `RESEND_API_KEY` | Real email send (optional) |
| `SALES_FROM_EMAIL` | Default From address |
| `SALES_DEMO_MODE` | Force demo discovery (`true`/`false`; auto when offline) |
