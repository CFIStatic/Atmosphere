# User service role titles

Analysis labels people with a **service role title** captured at signup, invite,
settings, or job invite — not from web-scraped legal names.

## Stable contract (speaker-identity / people-matching)

```ts
{ role: string; displayLabel: string }
```

| Field | Meaning |
| --- | --- |
| `role` | Curated slug: `homeowner`, `adjuster`, `estimator`, `project_manager`, `electrician`, `plumber`, `roofer`, `technician`, `crew`, `inspector`, `other` |
| `displayLabel` | Human label: `Homeowner`, `Electrician`, … or custom text when `other` |

`serviceTitle` in analysis payloads is an alias of `displayLabel`.

Format when both name and title are known: **`Alex — Electrician`**.
Homeowners always display as **`Homeowner`** (never a web-scraped legal name).

## Schema

| Column | Purpose |
| --- | --- |
| `profiles.service_role` (+ `service_role_custom`) | **Canonical** person title |
| `job_parties.service_role` (+ custom) | **Per-job override** when set |
| `job_progress_grants.service_role` | Always `homeowner` |
| `org_invites.service_role` (+ custom) | Advisory prefills at join |

`org_members.role` remains the **seat / product** role (Global Admin, Employee, …)
and is not overloaded.

## Precedence

1. Homeowner kind / progress grant → `{ role: 'homeowner', displayLabel: 'Homeowner' }`
2. `job_parties.service_role` when present
3. `profiles.service_role`
4. Derive from `job_parties.trade` / party role / `org_members.role`

## UI

- Signup / Settings: curated picker (+ optional custom for Other).
- Homeowner progress-share claim path: forces Homeowner (no trade picker).
- Org invite may suggest a service role; job Field Capture invites may set a job override.

## Coordination

`feat/speaker-identity-from-frame` reads `OrgMemberHint.serviceTitle` and
`deriveServiceTitle()`. This branch populates `role` / `displayLabel` /
`serviceTitle` on job roster endpoints so that work can consume profiles and
party overrides after merge — do not merge the branches into each other.
