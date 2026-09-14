# Auto daily job report

Opt-in end-of-day **Glance** summaries of that day’s Field Capture clips, emailed
to the homeowner and project manager. Nobody writes them.

## Behavior

- **Default off.** Org Global Admins enable it under Settings → Organization.
- **Timezone + send hour.** Uses `orgs.daily_job_report_timezone` (default
  `America/New_York`) and `daily_job_report_send_hour` (default 18). The sweep
  fires only after that local hour for the org’s local calendar day
  (`localDayKey`).
- **Idempotent.** One `daily_job_reports` row per `(org_id, job_id, local_day)`.
  Already `sent` / `skipped` / in-flight `pending` rows are not re-sent.
- **Content.** Glance-style: per-clip headline (conversation executive summary /
  summary), key moments, agreements, refusals, action items, people present —
  same spirit as Analysis Glance, not Full evidence.
- **Privacy.** Text and points that hit `ai_findings.privacyRedactions` or
  private-moment heuristics become `[privacy redacted]` / are omitted. Reports
  never quote bathroom / intimate intervals.
- **Empty day.** Jobs with zero clips that day are marked `skipped`.
- **No recipients.** If homeowner + PM (+ extras) resolve to no emails →
  `skipped` with `error=no_recipients`.

## Recipients

1. `job_parties` with `role=owner` or derived service role `homeowner`
2. Parties / org members derived as `project_manager`
3. Org Global Admins (fallback so a PM seat always exists)
4. Optional `daily_job_report_extra_emails`

## Channels

`daily_job_report_channel`: `email` | `sms` | `email_and_sms`.

Mail goes through `sendSystemMail` (Resend first, then SMTP / log sink).

**SMS is not wired** on this server (same as Field Identity claim codes). When
SMS is selected, Atmosphere emails instead and logs `daily_report_sms_skipped`.

## Worker

`startDailyJobReportSweep` runs with sold-path workers (`WORKER_ROLE=all` /
queue). Poll interval ~5 minutes.

## API

- `GET /api/daily-report/settings` — any org member
- `PATCH /api/daily-report/settings` — Global Admin
- `POST /api/daily-report/run` `{ jobId, localDay? }` — Global Admin QA trigger
  (ignores send hour)

## Migration

`20260914210000_daily_job_reports.sql` — org columns + `daily_job_reports` table.
