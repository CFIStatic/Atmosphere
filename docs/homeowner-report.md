# HomeOwner Report

Branch: `cursor/homeowner-report-18af`

A customer-facing portal for one restoration job. Homeowners open a private link
to follow tentative schedule and progress, see who to call, message the company,
upload a policy, and ask insurance questions shaped by the property location and
carrier. The restoration company decides what is shared.

---

## 1. Why it exists

CRM and Project Manager already hold the job: customer, address, carrier,
adjuster, schedule, drying, milestones, and drafted customer updates. None of
that was reachable to the homeowner without a phone call. This portal is the
read + ask surface for that specific job — not a second CRM.

---

## 2. Shape

```
Staff (PM project page)
  mint / revoke share link
  toggle visibility (schedule, drying, contacts, chat, policy, …)
  reply to homeowner chat
        │
        ▼
homeowner_portal_* tables  ──►  BFF projects safe DTO
        │
        ▼
Guest  /report/:token
  progress · who to call · chat · policy upload · insurance Q&A
```

Guests never receive a staff JWT. The BFF hashes the URL token, loads the share,
and builds a DTO under the project's visibility flags. Guest reads of `pm_*`
require `SUPABASE_SERVICE_ROLE_KEY` on the server.

---

## 3. Schema

Migration: `supabase/migrations/20260728143100_homeowner_portal.sql`

| Table | Role |
|---|---|
| `homeowner_portal_shares` | Token hash, status, welcome note, expiry |
| `homeowner_portal_visibility` | Disclosure flags, brand, chat channel toggles |
| `homeowner_portal_conversations` | Side threads: assistant / company / adjuster / group |
| `homeowner_portal_messages` | Messages inside a conversation |
| `homeowner_portal_policies` | Uploaded policy text for Q&A grounding |

Staff access is org-member RLS (`pm_can_manage` for mint/revoke/visibility).
Guest writes go through the admin client after token validation.

---

## 4. API

Prefix: `/api/portal`

**Staff (session cookie)**

- `GET  /projects/:projectId` — shares, visibility, recent messages
- `POST /projects/:projectId/shares` — mint link (raw token returned once)
- `POST /projects/:projectId/shares/:shareId/revoke`
- `PUT  /projects/:projectId/visibility`
- `POST /projects/:projectId/messages` — staff reply

**Guest (URL token)**

- `GET  /report/:token` — projected HomeOwner Report
- `GET|POST /report/:token/messages`
- `GET|POST /report/:token/policies`
- `POST /report/:token/ask` — location/carrier/policy-aware Q&A

---

## 5. UI

- Guest: `/report/:token` — ChatGPT-style chat with a **side conversation list**:
  - Assistant (job / insurance Q&A)
  - Company DM (homeowner ↔ restoration company)
  - Adjuster DM (homeowner ↔ adjuster)
  - Group (homeowner + company + adjuster)
- Staff: HomeOwner Report card on `PmProjectPage` — links, brand, visibility,
  and per-conversation replies (as company or as adjuster when coordinating)

Set **Company display name** and **Logo URL** on the project portal panel
(e.g. `ServiceMaster Recovery Services` + their logo HTTPS URL).

Regulation bullets adapt from the project's `region` and `carrier` (see
`backend/src/portal/regulations.ts`). The assistant reuses the technician Anthropic
key when configured; otherwise a deterministic fallback answers.

---

## 6. Apply

```bash
# Apply the new migration to your Supabase project, then ensure
# SUPABASE_SERVICE_ROLE_KEY is set on the BFF for guest access.
```

Approve customer updates in Project Manager as usual — only `approved` / `sent`
customer-audience updates appear on the report when that section is enabled.
