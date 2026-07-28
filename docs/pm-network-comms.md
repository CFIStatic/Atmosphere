# Partner network & adaptive internal comms

Companion to [`pm-orchestration.md`](./pm-orchestration.md).

Vendors and subcontractors only create leverage when they are **on Atmosphere**,
not sitting in a CRM address book. And the PM already has too many chat apps —
Atmosphere should open a conversation when the situation needs one, and stay
quiet otherwise.

---

## 1. Network effects

```
Invite vendor/sub ──► they create an Atmosphere org ──► partnership
         │                                                    │
         │                                                    ▼
         │                                          on-platform coordination
         │                                          (threads, procurement)
         │                                                    │
         └──────── more invites from both sides ◄─────────────┘
```

| Table | Role |
|---|---|
| `pm_partner_profiles` | How an org presents itself (trades, service areas, aggregate counters only) |
| `pm_partner_invites` | Viral edge — email/phone invite with redeemable token |
| `pm_partnerships` | Accepted relationship between two Atmosphere orgs |

**Hard rule:** only aggregate counters (`invites_sent`, `shared_jobs`, …) cross
org boundaries. Job content never does — same privacy split as the learning
layer.

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/pm/network` | Profile, partnerships, invites; claims accepted invites |
| PATCH | `/api/pm/network/profile` | Update how you appear |
| POST | `/api/pm/network/invites` | Create invite + digest thread + shareable URL |
| POST | `/api/pm/network/invites/:id/revoke` | |
| POST | `/api/pm/network/accept` | Accept token as the invitee's org |

Invite URL shape: `{FRONTEND_ORIGIN}/join-partner?token=…`

Cross-org token redemption under RLS still needs a narrow SECURITY DEFINER RPC
for production strangers; same-tenant / demo accept works today, and the inviter
`claimAcceptedInvites` path materialises partnerships when `accepted_org_id` is
set.

---

## 2. Adaptive internal threads

External messages stay in `pm_communications` (WhatsApp, iMessage, …).
**Internal** coordination lives in:

| Table | Role |
|---|---|
| `pm_threads` | Adaptive conversation (kind + mode + urgency) |
| `pm_thread_participants` | Users (and later partner orgs) on a thread |
| `pm_thread_messages` | Append-only messages; Atmosphere can post system notes |

### When Atmosphere opens a thread

Pure function `proposeThreadAdaptations(snapshot)`:

| Trigger | Kind | Mode |
|---|---|---|
| High/urgent pending approval | `approval_followup` | `live` |
| ≥2 unreviewed external messages on a job | `project_ops` | `live` |
| Open procurement | `procurement` | `digest` or `live` |
| Vendor/sub message traffic | `vendor_coordination` | `live` |
| Partner invite / acceptance | `network` | `digest` → `live` |

`origin_key` makes this idempotent — the same approval does not spawn a second
thread every engine pass. Modes adapt (`live` / `digest` / `muted`).

The engine applies adaptations after each automation pass (best-effort if the
migration is not applied yet).

### API

| Method | Path |
|---|---|
| GET/POST | `/api/pm/threads` |
| GET/PATCH | `/api/pm/threads/:id` |
| POST | `/api/pm/threads/:id/messages` |

---

## 3. Frontend

PM cockpit (`/pm`) tabs:

- **Threads** — open adaptive conversations, reply in-app
- **Network** — invite partners, see partnerships and pending invites

---

## 4. Migration

`supabase/migrations/20260728150000_pm_network_and_comms.sql`

Also widens `pm_communications` channel (`internal`) and counterparty
(`subcontractor`).

---

## 5. Not built (yet)

- Public stranger directory (discovery beyond existing partnerships)
- Cross-org SECURITY DEFINER accept RPC for production invite redemption
- Realtime websockets (polling / refresh is enough for v1)
- Ranking / ratings marketplace
