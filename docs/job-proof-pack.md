# Job proof pack (PDF report)

Downloadable PDF for a job file (or one work date) suitable for insurer / GC / homeowner review.

## Contents

- What happened
- Who (crew + people identified on clips)
- Decisions (day accept/reject + conversation agreements/commitments)
- Next steps (action items, unresolved questions, pending days)
- Timed quotes and key frames per clip

## Privacy

Ranges in `ai_findings.privacyRedactions` are respected:

- Quotes whose timestamps fall inside a private interval are **omitted**
- Key frames inside private intervals are **not** embedded
- The PDF footer states when intervals were redacted

## API

```
GET /api/operations/shared/:jobId/proof-pack.pdf
GET /api/operations/shared/:jobId/proof-pack.pdf?date=YYYY-MM-DD
```

Auth: org session (or job-progress viewer grant). Response: `application/pdf` attachment.

Platform: **Download report** on the job file Analysis card (and Proof of work / Evidence locker).
