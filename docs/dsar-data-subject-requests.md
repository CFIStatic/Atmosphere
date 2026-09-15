# DSAR / data-subject request runbook (engineering)

**Not legal advice.** This is an operator checklist for locating, exporting, and
deleting Atmosphere data when counsel or a customer files an access, export, or
deletion request (CCPA/CPRA-style, GDPR-style, or contractual). Confirm scope
and lawful basis with counsel before acting.

## Scope questions (ask first)

1. **Who** is the subject? (org employee login, homeowner invitee, job-share
   party email, progress-share guest, verifier share recipient)
2. **Which org / jobs?** Atmosphere is multi-tenant; do not cross orgs.
3. **Access vs delete?** Soft-delete + legal hold may block purge — see
   `docs/legal-hold.md`.
4. **Deadline / ticket id** for the audit trail (`user_activity_events` /
   counsel notes).

## Where personal data lives (map)

| Surface | Tables / buckets | Typical PII |
| --- | --- | --- |
| Auth login | Supabase `auth.users`, `auth.sessions`, `auth.refresh_tokens` | email, phone, session metadata |
| Profile | `profiles` | email, full name, avatar URL |
| Org membership | `org_members`, `org_invites` | role, work type, invite email |
| Jobs / CRM | `crm_jobs`, `crm_properties`, related CRM | addresses, claim #, contacts |
| Field video | `job_proofs`, Storage bucket **`job-proofs`** | A/V of homes, GPS on proof rows, `device_metadata` |
| Live parts | `proof_live_sessions`, `.parts/` objects under `job-proofs` | near-live unredacted segments |
| Frames | `job_proof_frames` (+ objects under proof paths) | stills sent to vision |
| Transcripts / narration | `job_proofs.transcript_text`, narration / evidence fields | speech, names spoken |
| AI findings | `ai_findings` (privacy / child ranges, motion clips, peoplePresent, etc.) | derived sensitive intervals |
| Ask | `ask_threads` (+ messages if present) | user questions about jobs |
| Shares | `verifier_shares.access_token`, `job_parties.access_token`, `job_progress_grants` | bearer tokens, recipient emails |
| Activity | `user_activity_events` | IP/UA may appear if stored; actions |
| Billing | Stripe customer (via org billing tables) | billing email — homeowners should be exempt |
| Avatars | public `avatars` bucket | profile photo |
| Legal vault | `legal_video_vault`, holds | preserved copies — **do not delete under hold** |

Third-party processors that may retain copies briefly: OpenAI (transcription),
Google Gemini, Anthropic (vision / Ask). See `docs/ai-vendor-data-controls.md`.

## Access / export (operator steps)

1. Authenticate as platform staff with analytics/legal scope (or use service
   role only from a controlled break-glass session).
2. Resolve `user_id` / email → `org_members` / `profiles`.
3. List orgs and jobs the subject touched (`org_members`, `job_parties`,
   progress grants, activity events).
4. For each in-scope job, export:
   - proof catalog rows (`job_proofs` metadata — not necessarily all bytes)
   - transcript / AI finding JSON the subject contributed or that depicts them
   - share/invite rows addressed to their email
5. Package as JSON/CSV + a manifest of storage paths. **Do not** email raw
   day films unless counsel requires it; use short-lived signed URLs and log
   the production in the legal/hold tools when applicable.
6. Record who ran the export, ticket id, and time.

## Deletion (operator steps)

1. **Check legal hold** on org/job/video (`docs/legal-hold.md`). If held,
   refuse customer purge; preserve and notify counsel.
2. Soft-delete visible proofs (`deleted_at`) via Global Admin delete paths —
   see video delete policy. Confirm 30-day purge sweep will remove bytes when
   not held (`proofPurgeSweep`).
3. Revoke share tokens (`verifier_shares`, job-party tokens, progress grants)
   for the subject’s email.
4. Remove org membership (`DELETE /api/org/members/:userId`) — this also
   **revokes Auth sessions** (global sign-out). Withdraw pending invites.
5. Clear or anonymize `profiles` fields if the Auth user will remain for other
   orgs; if the login is only for this tenant and counsel approves, Auth
   `deleteUser` is a separate, irreversible step.
6. Ask threads / activity: delete or redact rows tied to `user_id` when in
   scope and not required for security logs.
7. Vendor side: rely on retention settings in
   `docs/ai-vendor-data-controls.md`; open vendor deletion tickets only when
   counsel requires confirmation beyond configured retention.
8. Confirm Storage: list `job-proofs/{orgId}/…` objects still referencing the
   subject after purge window; remove leftovers only if not on hold.

## Share tokens & guests

Guest/progress/verifier access is **bearer-token** based. For DSAR deletion,
revoke tokens and rotate if an email was resent. Guests typically have no Auth
user — search by email on grant/share/party tables.

## What engineering does *not* automate today

- End-user self-serve DSAR portal
- Guaranteed erasure of every third-party model log beyond vendor retention
  settings
- Re-encoding of already-shared raw signed URL downloads

Document gaps for counsel; do not claim automated CCPA fulfillment in product
copy until tooling exists.
