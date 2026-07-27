# Atmosphere CRM — backend infrastructure

Internal today, a product later. This document covers what exists, why it is
shaped this way, and what is deliberately not built yet.

Three subsystems ship together, because separately none of them solves the
problem:

1. **The CRM** — customers, properties, leads, jobs, and the timeline that ties
   them together.
2. **The external mirror** — our own verbatim copy of the data that currently
   lives only inside other companies' software.
3. **Backups** — full encrypted snapshots plus a row-level change ledger.

---

## 1. Why this exists

Today the business runs on other people's applications. That data is ours, but
it only exists inside a vendor's account — one billing lapse, one API
deprecation, one acquisition away from being unreachable. And even the data we
*do* own sits in exactly one database.

So the goal is not "add a CRM screen". It is: **own the record of the business,
in a form we can read without asking anyone's permission.** Everything below
follows from that.

---

## 2. Data model

All tables are `org_id`-scoped with RLS enabled, and every query the backend
makes runs under the caller's JWT. Row Level Security — not application code —
is what keeps one company's customers invisible to another's.

### CRM core (`20260726000001_crm_core.sql`)

| Table            | Purpose                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `crm_accounts`   | Companies: carriers, property managers, GCs, referral partners.     |
| `crm_contacts`   | People: homeowners, tenants, adjusters, agents.                     |
| `crm_properties` | Loss locations. Separate from contacts on purpose — see below.      |
| `crm_leads`      | Work we might win.                                                  |
| `crm_jobs`       | Work we won, including the claim/policy fields.                     |
| `crm_activities` | One timeline: notes, calls, site visits, tasks, status changes.     |
| `crm_counters`   | Per-org sequences behind human-facing job numbers.                  |

Some decisions worth knowing:

- **Properties are their own table.** In this trade the same loss location
  recurs across owners, tenants, and carriers, and the access notes ("lockbox
  code", "dog in the back yard") belong to the address, not to a person.
- **One activity table, not five.** A single timeline is what makes "what
  happened on this job?" answerable in one query — the question the office
  actually asks.
- **Claim fields live on the job.** Most restoration work is paid by a carrier,
  so the claim number, policy number, deductible, adjuster, and carrier are
  first-class job columns rather than a bolt-on table.
- **Job numbers come from a counter, in a trigger.** Gap-free and per-org under
  concurrency, and assigned no matter which path wrote the row — route, import,
  or backfill.
- **`org_id` and `created_by` are frozen after insert.** A trigger pins them, so
  an UPDATE cannot move a record between organizations even if RLS somehow let
  it through.

### External mirror (`20260726000002_crm_external_mirror.sql`)

| Table                   | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `crm_external_sources`  | One row per external application we mirror.             |
| `crm_external_records`  | The copy: verbatim JSON, hashed, versioned, append-only.|
| `crm_sync_runs`         | Every pull attempt, successful or not.                  |

Two rules are enforced by the database rather than by convention:

- **Payloads are append-only.** A trigger refuses any UPDATE that touches the
  payload, and refuses DELETE outright. A changed record becomes version N+1;
  the old version stays with `is_current = false`. That is what turns the mirror
  from a cache into a history — we can answer "what did the vendor have on the
  3rd?", which is the question that matters when a customer disputes something.
- **Credentials never land in the database.** A source stores the *name* of a
  secret (`credential_ref`, constrained to `[A-Z0-9_]`), and the server resolves
  `ATM_INTEGRATION_<NAME>` from its environment. A dump of this table leaks no
  way to reach the vendor.

Mirrored rows are written only by the server's sync worker under the service
role. A member can read the mirror but cannot forge a record and claim a vendor
said it.

### Backups and the change ledger (`20260726000003_backup_ledger.sql`)

| Table                   | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `backup_snapshots`      | One row per snapshot: status, checksum, size, expiry.   |
| `backup_snapshot_items` | Per-table row counts and hashes.                        |
| `backup_verifications`  | Every verification attempt, not just the latest.        |
| `crm_audit_log`         | Append-only row-level change ledger.                    |

Everything here is **SELECT-only** for `authenticated`. There is no INSERT,
UPDATE, or DELETE grant on any of these tables for a user session — the backup
worker runs with the service role. Nobody holding a session can write a backup
record, edit a checksum, or erase an audit entry, which is the only way "the
ledger says X" is worth anything.

---

## 3. The two backup mechanisms

They fail differently, which is why there are two.

### Snapshots — survives losing the database

A full export of every table, written **outside** the database, gzipped,
encrypted, and checksummed. Coarse: you restore to the last snapshot and lose
whatever happened since.

Archive format, outermost first:

```
[ AES-256-GCM envelope ]      ← only when BACKUP_ENCRYPTION_KEY is set
  [ gzip ]
    [ NDJSON ]                ← header line, then {"t":"<table>","d":{…}} per row
```

Envelope layout: `magic (8) | iv (12) | ciphertext | auth tag (16)`.

NDJSON rather than one JSON document because a snapshot can exceed memory in
both directions — the writer streams rows out as it reads them, and the reader
replays them a line at a time. Reading a backup costs the same whether the
company has 200 rows or 2 million.

Three properties are load-bearing:

- **Keyset pagination.** Rows are read in `id` order with a `>` cursor, never
  with OFFSET. Under concurrent writes an OFFSET walk skips and duplicates rows
  — the kind of corruption you discover during a restore, when it is too late.
- **The catalog row is written first.** A snapshot that dies halfway leaves a
  `running` row that ages into a visible failure. Silence is the one thing a
  backup system must never report.
- **Checksums cover what storage received**, not what we meant to send, so
  verification can actually detect a bad write.

### The change ledger — survives a mistake

Triggers on every CRM table write an entry into `crm_audit_log` **in the same
transaction as the change itself**, capturing the row before and after. A
committed write is a recorded write; there is no window where data changes
without an entry.

This is the fine-grained half. It is how one mistakenly deleted customer gets
restored without rolling anything else back — and how you find out who changed
what, when.

A snapshot alone means "we lose a day". A ledger alone means "we lose everything
if the database dies".

### What is excluded, and why

`device_credentials` is deliberately **not** backed up. PIN and device-secret
hashes are re-enrollable in seconds and worthless to a restore, but archives get
copied to laptops and object stores — places the database never goes. Excluding
them keeps the PIN design's blast radius exactly where it was designed to be.

The backup catalog tables are excluded too: they describe the archive being
written, and are regenerated rather than restored.

**Adding a table without adding it to `src/lib/backup/tables.ts` means it is not
backed up, and nothing else will tell you.** The exporter guards against this by
listing the database's public tables and warning about any it does not
recognise.

---

## 4. Operating backups

```bash
npm run backup                    # platform-wide snapshot, then verify it
npm run backup -- --org <uuid>    # one organization
npm run backup:list               # recent snapshots and their health
npm run backup:verify -- <id>     # decrypt, decompress, count every row back
npm run backup:retention          # expire archives past their window
```

Restore is a **dry run** unless `--confirm` is passed:

```bash
npm run backup:restore -- <snapshotId> --tables crm_jobs,crm_contacts
npm run backup:restore -- <snapshotId> --tables crm_jobs --confirm
```

Rows are upserted by primary key rather than truncating, so records written
since the snapshot survive and a restore aimed at one table cannot cascade into
others. Recovering a specific loss is the common case; wholesale rollback is
rare and deserves a deliberate, separate procedure.

### Verification

`checksum` re-hashes the stored bytes. `deep` (the default) additionally
decrypts, decompresses, and counts every row back out against the manifest.

Only the deep check proves the archive is a *backup* rather than merely intact.
The scheduler runs one immediately after every snapshot, because an archive that
cannot be read back is worth knowing about now, not during an incident.

Untested backups are the industry's most reliable way to discover, during an
outage, that there were no backups.

### The scheduler

A plain interval inside the API process — the right size for a single-instance
deployment, and honest about its limit: **run several instances and each will
take its own snapshot.** When that day comes, move it to a dedicated worker or a
cron trigger; the runner takes no dependency on being called from the scheduler.

Each cycle: snapshot → deep verify → apply retention.

---

## 5. Mirroring an existing application

```
POST /api/integrations/sources          register an application
POST /api/integrations/sources/:id/sync pull now (REST)
POST /api/integrations/sources/:id/import  mirror a CSV export
GET  /api/integrations/records          read the mirror
```

Two connectors ship, and neither is named after a specific vendor:

- **REST** — a generic paginated JSON connector. The shape of the API is
  configuration (base URL, entity paths, id fields, pagination style), so a new
  system becomes a row rather than a code change and a deploy. The applications
  a restoration company runs on differ per company and change every couple of
  years.
- **CSV** — the unglamorous path that actually matters. Most legacy job
  management and accounting software will not give you an API, but every one of
  them has an "Export to CSV" button.

A connector's only job is to hand back records verbatim. It does not map fields
or decide what a record means — normalising into the CRM happens later,
separately, and reversibly. When a mapping turns out to be wrong, the original
is still there to re-derive from.

### Change detection

Payloads are hashed canonically (keys sorted), so re-fetching an unchanged
record writes nothing. A nightly full pull of 50,000 records costs almost nothing
after the first run, and key reordering by a vendor's serializer does not
masquerade as a change.

### SSRF

The REST connector is a server-side fetcher driven by user-supplied
configuration — the exact shape of a server-side request forgery if left
unchecked. Base URLs are validated before any request: http(s) only, and
loopback, link-local (`169.254.*`, where cloud instance-metadata credentials
live), and private ranges are refused. Redirects are not followed, since a
redirect could land somewhere the check rejected.

### Truncated runs are `partial`, not `succeeded`

A run that hits `INTEGRATION_MAX_RECORDS` is recorded as partial. Calling a
half-complete copy a success is how a gap goes unnoticed for months.

---

## 6. API surface

All routes require a session cookie. All are org-scoped through the caller's JWT.

### CRM

| Method | Path                             | Description                              |
| ------ | -------------------------------- | ---------------------------------------- |
| GET    | `/api/crm/summary`               | Pipeline and workload counts             |
| GET    | `/api/crm/audit`                 | Change ledger for the caller's org       |
| GET/POST | `/api/crm/{resource}`          | List (paginated, `?search=`) / create    |
| GET/PATCH/DELETE | `/api/crm/{resource}/:id` | Read / partial update / archive       |
| POST   | `/api/crm/leads/:id/convert`     | Turn a won lead into a job               |
| GET    | `/api/crm/jobs/:id/timeline`     | Everything that happened on a job        |

`{resource}` ∈ `accounts | contacts | properties | leads | jobs | activities`.

`DELETE` **archives** by default on archivable resources; `?hard=true` deletes.
Customer history is the asset this system exists to accumulate, and a misplaced
click should not be able to burn it.

### Backups

| Method | Path                        | Description                             |
| ------ | --------------------------- | --------------------------------------- |
| GET    | `/api/backups/status`       | Config, last completed snapshot, coverage |
| GET    | `/api/backups`              | Snapshot history                        |
| GET    | `/api/backups/:id`          | One snapshot + per-table manifest       |
| POST   | `/api/backups`              | Snapshot this org now (rate limited)    |
| POST   | `/api/backups/:id/verify`   | Prove the archive is still restorable   |

**There is no download endpoint, on purpose.** An archive is a decrypted copy of
every customer record an org holds; handing that to a browser on the strength of
a session cookie would undo the reason it is encrypted at rest. An export for a
departing customer belongs in a separate, deliberate flow.

Platform-wide snapshots are operator-only — driven by the scheduler and the CLI,
never by an HTTP request carrying a tenant's session.

### Integrations

| Method | Path                                        | Description                    |
| ------ | ------------------------------------------- | ------------------------------ |
| GET/POST | `/api/integrations/sources`               | List / register a source       |
| PATCH/DELETE | `/api/integrations/sources/:id`       | Update / disable (`?purge=true` to delete the copy) |
| POST   | `/api/integrations/sources/:id/sync`        | Pull now                       |
| POST   | `/api/integrations/sources/:id/import`      | Mirror a CSV export            |
| GET    | `/api/integrations/sources/:id/runs`        | Sync history                   |
| GET    | `/api/integrations/records`                 | The mirror (`?history=true` for all versions) |

`DELETE` disables by default and keeps the mirrored records. Purging is the only
way mirrored data is ever removed — the append-only trigger refuses everything
else — so it has to be spelled out.

---

## 7. Applying the migrations

The migration files are in `backend/supabase/migrations/`. They have **not** been
applied to the live Supabase project; run them against a branch or staging
project first.

```bash
supabase db push          # with the Supabase CLI linked to the project
```

They are additive — new tables, types, functions, and triggers only. Nothing in
the existing auth or onboarding schema is modified.

---

## 8. Checks

```bash
npm run check         # typecheck + archive + CSV self-checks
npm run check:backup  # archive round-trip, corruption detection
npm run check:csv     # CSV edge cases, hash stability
```

No test framework and no database required, so `check:backup` can run on a
machine holding the production key — which is exactly where you want to learn
that archives cannot be read back.

The corruption cases are the ones that matter. An archive that fails to verify
is recoverable; an archive that reads back *wrong*, or that crashes the verifier,
is how a restore silently produces a half-empty database.

---

## 9. Deliberately not built yet

Named so nobody assumes otherwise:

- **No frontend.** This is backend infrastructure; the CRM has no UI.
- **No per-role permissions inside an org.** Every member of an organization can
  see and edit all of its CRM data. The `member_role` enum exists, but no policy
  reads it. A field technician can currently see contract amounts.
- **No promotion from mirror to CRM.** `crm_external_records.linked_table` /
  `linked_id` exist for the lineage, but nothing writes them yet — mirrored data
  is stored and readable, not yet normalised into native records.
- **No scheduled syncs.** `sync_interval_minutes` is stored but the scheduler
  only runs backups. Pulls are triggered manually.
- **No multipart upload.** The Supabase storage driver refuses archives over
  512MB rather than silently truncating them.
- **Snapshots are full, never incremental.** Fine at current data volumes;
  revisit when a snapshot stops finishing comfortably inside its interval.
