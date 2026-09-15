# AI vendor data controls (production ops)

**Ops checklist — not a claim that application code already enforces these
settings.** Atmosphere sends job-derived content (audio clips, frames, Ask
prompts/transcripts) to third-party model APIs. Configure each vendor project
so **customer content is not used to train** foundation models and retention
matches counsel’s instructions.

## Providers in use

| Provider | Atmosphere use | Typical env / config |
| --- | --- | --- |
| **OpenAI** (Whisper / audio transcriptions API, optional Chat-compatible) | Proof captions / STT (`TRANSCRIPTION_*` or `OPENAI_API_KEY`) | `OPENAI_API_KEY`, `OPENAI_BASE_URL` |
| **Google Gemini** | Vision dictation / analysis frames | `GOOGLE_API_KEY` |
| **Anthropic** | Ask / analysis text (Claude) | `ANTHROPIC_API_KEY`, model env overrides |

Other OpenAI-compatible STT endpoints (Groq, self-hosted whisper.cpp) may be
wired via `TRANSCRIPTION_URL` / `TRANSCRIPTION_API_KEY` — apply the same “no
training / short retention” bar to those hosts.

## Required production dashboard settings (verify manually)

For **each** production project/key used by Railway `Keys`:

1. **Disable training / improvement on customer content** where the vendor
   offers an org-level or API-key toggle (e.g. OpenAI data controls / “do not
   train”, Google Cloud / Gemini data governance, Anthropic zero-retention or
   equivalent commercial terms).
2. **Retention**: set the shortest retention counsel accepts for API logs and
   abuse-monitoring stores; document the value (e.g. 0-day zero-retention vs
   30-day).
3. **Region / residency** if under contract — confirm the project’s region
   matches the DPA.
4. **Key hygiene**: production keys only on the Atmosphere Railway services;
   never in mobile apps or website bundles.
5. **Subprocessors**: keep the vendor list aligned with the Privacy Policy /
   DPA exhibit when counsel updates messaging.

## What code does *not* guarantee

- Atmosphere does **not** currently block requests if a vendor account still
  has training enabled — misconfiguration is an ops failure mode.
- Prompt/response logging inside Atmosphere (metering / token usage) is
  separate from vendor retention; scrub or limit those tables under the DSAR
  runbook (`docs/dsar-data-subject-requests.md`).

## Cadence

- **At go-live** and **after any key rotation**: screenshot or export the
  vendor “data controls / retention” page into the security folder.
- **Quarterly**: re-check toggles; confirm new models/APIs inherit the same
  controls.

## Related

- Privacy / redaction product behavior: `docs/privacy-redaction.md`,
  `docs/child-privacy-redaction.md`
- Production deploy / Keys: `docs/production.md`
