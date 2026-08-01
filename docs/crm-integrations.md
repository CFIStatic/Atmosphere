# CRM Integrations — connect any system

Salespeople live in Dash, Luxor, Salesforce, HubSpot, JobNimbus, Encircle, and
dozens of other tools. Atmosphere does not ask them to abandon those — it
**connects**, **pulls** a durable copy, **promotes** contacts onto the map, and
**pushes** notes and updates back.

---

## 1. Flow

```
Connect CRM  →  Sync (pull mirror)  →  Promote (native CRM)  →  Email Marketing map
                      ↑                                              │
                      └──────────── Push notes / contacts ←──────────┘
```

1. **Connect** from `/integrations` — pick a catalog CRM or generic REST/CSV.
2. **Sync** pulls records into the append-only external mirror.
3. **Promote** maps contacts / properties / accounts into Atmosphere CRM
   (including lat/lng when present) so storm outreach can see them.
4. **Push** writes notes, tasks, or contacts back into the vendor.

---

## 2. Catalog

| System        | Pull | Push | Notes                                      |
| ------------- | ---- | ---- | ------------------------------------------ |
| Dash          | ✓    | ✓    | Customers, properties, jobs, notes         |
| Luxor         | ✓    | ✓    | Contacts, locations, follow-ups            |
| Salesforce    | ✓    | ✓    | Contacts, accounts, tasks                  |
| HubSpot       | ✓    | ✓    | Contacts, companies, notes                 |
| JobNimbus     | ✓    | ✓    | Contacts, jobs, activities                 |
| Encircle      | ✓    | —    | Contacts and properties                    |
| Any REST CRM  | ✓    | ✓    | Configure paths / auth / pagination        |
| CSV export    | ✓    | —    | Works when a vendor has no API             |

Every named CRM supports a **sandbox** mode so connect → sync → promote → push
is exercisable without live vendor credentials.

---

## 3. Credentials

Two ways, both safe:

| Mode     | How                                                                 |
| -------- | ------------------------------------------------------------------- |
| Sealed   | Entered in the UI, AES-256-GCM encrypted with `INTEGRATIONS_CREDENTIAL_KEY`. Ciphertext only in Postgres. |
| Env ref  | Source stores `credential_ref`; server reads `ATM_INTEGRATION_<REF>`. |

Secrets are never returned by the API.

---

## 4. API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET    | `/api/integrations/catalog` | List connectable CRMs |
| POST   | `/api/integrations/connect` | Connect from UI (seals credentials) |
| GET/POST/PATCH/DELETE | `/api/integrations/sources` | Manage sources |
| POST   | `/api/integrations/sources/:id/sync?promote=true` | Pull (+ promote) |
| POST   | `/api/integrations/sources/:id/promote` | Mirror → native CRM |
| POST   | `/api/integrations/sources/:id/push` | Write note/contact into CRM |
| POST   | `/api/integrations/sources/:id/import` | CSV mirror (+ optional promote) |
| GET    | `/api/integrations/records` | Read the mirror |
| GET    | `/api/integrations/sources/:id/runs` | Sync history |
| GET    | `/api/integrations/sources/:id/pushes` | Push history |

---

## 5. Why the mirror stays separate

Vendor JSON is stored **verbatim** and append-only. Promote is a separate,
reversible step. When a field mapping is wrong, the original is still there to
re-derive from — that is what makes the copy trustworthy.
