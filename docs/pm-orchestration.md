# Project Manager Orchestration

Extends the [Project Manager Agent](./project-manager-agent.md) so a human PM can
run many more jobs. Atmosphere watches the platforms the work already lives on,
documents conversations when someone `@atmosphere`-mentions the agent in a text
thread, derives equipment lists from estimates, collects dumpster bids, and
routes material orders through Atmosphere referral links. **The human still
decides** — every irreversible action lands in `pm_approvals` first.

Branch: `cursor/pm-orchestration-platforms-21ff`

---

## 1. What this adds

| Capability | What it does | Human gate |
|---|---|---|
| **Platform orchestration** | Connect Dash, XactAnalysis, Xactimate, Outlook; link projects to external IDs; sync status in | Outbound writes become approvals |
| **Messaging intake** | Bridges POST `@atmosphere` mentions from iMessage / WhatsApp / Signal / SMS | Action-shaped mentions open approvals; inbox for review |
| **Situation timeline** | One feed of alerts + comms + platform events + approvals + procurement | Read-only awareness |
| **Equipment from estimate** | Deterministic BOM from mitigation / construction estimate line items | Plan is draft until approved |
| **Dumpster bids** | Web search (or local shortlist) for roll-off haulers | Selecting a bid opens an approval |
| **Material referrals** | Home Depot, Lowe's, ABC Supply, SiteOne deep links with Atmosphere referral codes | Opening the order is an approval |

The thesis is unchanged: the agent is not smarter than the PM, it is never bored
— and it never acts alone when the action cannot be undone.

---

## 2. Shape

```
 Platforms          Messaging bridges         Estimates
 Dash / XA /         @atmosphere in            mitigation /
 Xactimate /         iMessage·WhatsApp·        construction
 Outlook             Signal·SMS
        │                    │                      │
        ▼                    ▼                      ▼
   pm_platform_*      pm_communications     equipment plan
        │                    │                      │
        └────────────┬───────┴──────────┬───────────┘
                     ▼                  ▼
              pm_approvals      pm_procurement_*
                     │                  │
                     └────────┬─────────┘
                              ▼
                     Situation + alerts
                     (PM decides)
```

---

## 3. Schema

Migration: `supabase/migrations/20260728142600_pm_orchestration.sql`

| Table | Role |
|---|---|
| `pm_platform_connections` | Org-level Dash / XA / Xactimate / Outlook link |
| `pm_platform_links` | Project ↔ external object |
| `pm_platform_events` | Append-oriented sync / activity log |
| `pm_communications` | Documented messages (mentions + manual) |
| `pm_approvals` | Human-in-the-loop queue |
| `pm_equipment_plans` / `_items` | BOM derived from an estimate |
| `pm_vendor_referrals` | Atmosphere referral catalogue |
| `pm_procurement_requests` / `_bids` | Dumpster bids + material referral orders |

Also widens `pm_alerts.category` and `pm_tasks.category` for orchestration /
communication / procurement findings.

Same guarantees as the core PM schema: RLS under the caller's JWT, no DELETE,
child `org_id` overwritten from the project, money in integer cents.

---

## 4. New rules

| Rule | Fires when |
|---|---|
| `approval_pending` | An approval is sitting in the queue |
| `communication_unreviewed` | An `@atmosphere` message is still `new` |
| `equipment_plan_gaps` | Plan items (including dumpster) are still `needed` |
| `procurement_awaiting` | A request is bidding or awaiting approval |
| `platform_sync_stale` | A linked platform has not synced recently |

---

## 5. API

All under `/api/pm` (auth), plus one webhook:

| Method | Path | Notes |
|---|---|---|
| GET | `/situation` | Unified timeline + counts |
| GET/POST | `/platforms`, `/platforms/connect` | Catalogue + connect |
| POST | `/platforms/:platform/disconnect` | |
| GET/POST | `/projects/:id/platforms` | Link external IDs |
| POST | `/platforms/links/:id/sync` | Record a sync; optional proposed action |
| GET/POST | `/approvals`, `/approvals/:id/decide` | Queue + decide |
| GET/POST/PATCH | `/communications` | Inbox |
| POST/GET | `/projects/:id/equipment-plan` | Derive / list plan from estimate |
| GET | `/procurement`, `/procurement/referrals` | |
| POST | `/projects/:id/procurement/dumpster` | Search bids |
| POST | `/projects/:id/procurement/materials` | Mint referral + approval |
| GET/POST | `/procurement/:id/bids`, `…/select-bid` | |
| POST | `/api/webhooks/atmosphere-mention` | HMAC-signed bridge intake |

### Mention webhook

Header: `X-Atmosphere-Signature: sha256=<hmac-hex-of-raw-body>`

Secret: `ATMOSPHERE_MENTION_WEBHOOK_SECRET`. Without it the endpoint refuses
everything. Body includes `orgId`, `channel`, `body`, and optional match hints
(`claimNumber`, `phone`, `addressHint`, `projectId`).

---

## 6. Configuration

| Variable | Required | Notes |
|---|---|---|
| `ATMOSPHERE_MENTION_WEBHOOK_SECRET` | for bridges | HMAC key for mention intake |
| `PM_WEB_SEARCH_URL` | no | Dumpster search template (`{q}`, `{zip}`); falls back to a local shortlist |
| Existing estimator / web-access credentials | for live vendor HTTP | Orchestration records links; live pulls reuse those connectors |

---

## 7. Frontend

The PM cockpit (`/pm`) gains tabs:

- **Approvals** — approve / reject proposed actions
- **Inbox** — `@atmosphere` messages
- **Threads** — adaptive internal conversations (opened when needed)
- **Network** — invite vendors/subs onto Atmosphere
- **Procurement** — dumpster bids + referral orders
- **Platforms** — connect Dash / XA / Xactimate / Outlook

The "Waiting on you" stat combines pending approvals and unreviewed messages.

Partner network + adaptive threads: [`docs/pm-network-comms.md`](./pm-network-comms.md).

---

## 8. Deliberately still not built

- **Auto-send** on any channel — drafts and documented messages only
- **Silent Xactimate / Dash writes** — always via `pm_approvals`
- **Affiliate payout ledger** — referral links carry the code; commission
  settlement with vendors is a later billing concern
- **Native iMessage/WhatsApp/Signal apps** — Atmosphere exposes the intake
  webhook; org-operated bridges call it
