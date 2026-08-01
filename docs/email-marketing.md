# Email Marketing — storm outreach

Sales-facing outreach that sits on top of the CRM. Contacts and properties
already live in Atmosphere; this feature puts them on a map, watches weather for
storms that threaten those locations, and sends a personal check-in when someone
is in the path — then follows up after the weather clears.

---

## 1. What it does

1. **CRM map** — every property (and contact address when geocoded) is plotted
   so a salesperson can see where their book of business actually is.
2. **Storm watch** — active severe-weather alerts are pulled from the National
   Weather Service (or a demo feed in development) and matched against those
   points.
3. **Custom outreach** — contacts in a storm's path get a drafted email that
   names the storm, their city, and a short offer of help. Opt-outs on
   `crm_contacts.marketing_opt_out` are never emailed.
4. **Follow-up check-ins** — after the storm window, a second message asks if
   everything is alright and whether they need mitigation help.

This is not a bulk blast tool. Every send is tied to a specific storm and a
specific contact, and the CRM activity timeline records what went out.

---

## 2. Data model

All tables are `org_id`-scoped with RLS, same shape as the CRM.

| Table                    | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `em_settings`            | One row per org: from-name, reply-to, auto-send, follow-up.  |
| `em_storms`              | Identified weather events (NWS id or manual / demo).         |
| `em_outreach`            | One outreach run per storm (draft → sending → sent).         |
| `em_outreach_messages`   | Per-contact email: draft body, send status, provider id.     |
| `em_checkins`            | Scheduled / completed post-storm follow-ups.                 |

Storm geometry is stored as a center point plus radius miles, with an optional
GeoJSON polygon when the weather feed provides one. Matching uses the polygon
when present, otherwise the radius circle.

---

## 3. Weather

`WEATHER_PROVIDER` chooses the feed:

| Value   | Behaviour                                              |
| ------- | ------------------------------------------------------ |
| `nws`   | Live National Weather Service alerts (`api.weather.gov`) |
| `demo`  | Deterministic demo storms around the org's contacts    |
| `auto`  | Try NWS; fall back to demo if the network call fails   |

Default is `auto`. No API key is required for NWS.

---

## 4. Email delivery

`EMAIL_MARKETING_PROVIDER` chooses how messages leave the building:

| Value    | Behaviour                                                |
| -------- | -------------------------------------------------------- |
| `log`    | Default. Records the send and marks it delivered without leaving the server. Safe for development. |
| `resend` | Sends through [Resend](https://resend.com) when `RESEND_API_KEY` is set. |

A CRM `email` activity is written for every successful send so the contact's
timeline stays complete.

---

## 5. API surface

Mounted at `/api/email-marketing` (auth + org context required):

| Method | Path                         | Purpose                                      |
| ------ | ---------------------------- | -------------------------------------------- |
| GET    | `/map`                       | Contacts/properties with coords + active storms |
| GET    | `/settings` / PATCH          | Org outreach settings                        |
| POST   | `/storms/scan`               | Pull weather, upsert storms, report matches  |
| GET    | `/storms`                    | List storms for the org                      |
| GET    | `/storms/:id/matches`        | Contacts in a storm's path                   |
| POST   | `/outreach`                  | Draft outreach for a storm's matches         |
| GET    | `/outreach` / `/:id`         | List / detail (messages included)            |
| POST   | `/outreach/:id/send`         | Send all draft messages                      |
| POST   | `/outreach/:id/messages/:mid/send` | Send one message                       |
| PATCH  | `/outreach/:id/messages/:mid`| Edit draft subject/body before send          |
| POST   | `/checkins/schedule`         | Schedule follow-ups after a storm            |
| GET    | `/checkins`                  | List check-ins                               |
| POST   | `/checkins/:id/send`         | Send a check-in email                        |
| PATCH  | `/checkins/:id`              | Mark complete / note outcome                 |

---

## 6. UI

`/email-marketing` — AppShell page with three jobs:

1. **Map** — contact pins and storm footprints.
2. **Storms** — scan weather, review who is in the path, draft outreach.
3. **Check-ins** — follow-ups due after the weather passes.

---

## 7. Connecting salesperson CRMs

Use **Integrations** (`/integrations`) to connect Dash, Luxor, Salesforce,
HubSpot, JobNimbus, Encircle, any REST CRM, or a CSV export. Sync pulls a
verbatim mirror; **Promote** maps contacts and properties into Atmosphere CRM
(with coordinates when the vendor provides them). Email Marketing then plots
those contacts automatically.

Push notes and contacts back into the connected CRM from the same page.

See `docs/CRM.md` §5–6 and the Integrations catalog for auth shapes.

---

## 8. Deliberately not built yet

- A/B subject lines, drip sequences, or open/click analytics.
- SMS or phone check-ins.
- Automatic geocoding of addresses that lack lat/lng (unmapped rows are counted
  and skipped until coords exist — either from the vendor or a later geocode pass).
