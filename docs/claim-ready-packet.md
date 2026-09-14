# Claim-ready packet

Zero-to-one structured **claim packet** for a job file: carrier-ish fields built
only from evidenced data. Separate from any proof-pack PDF export.

## Fields

| Field | Source | Invent? |
|-------|--------|---------|
| Dates on site | Distinct `job_proofs.work_date` | Never |
| Parties | Active `job_parties` | Never |
| Damage / observations | Evidence log, material change, concerns, scope reasons that look like damage | Never invent; omit when empty |
| Cause | Only when speech/analysis explicitly evidences cause (insurance / concern language) | Never invent — `null` if absent |
| Photos / frames | `job_proof_frames` (`proofId`, `atSeconds`, storage path) | Never |
| Who said what | Conversation turns + said/speech evidence entries, with times | Privacy-redacted when in range |

## API

`GET /api/operations/shared/:jobId/claim-ready`

Schema: `atmosphere.claim_ready_packet.v1`

Response includes `gaps` (honest missing pieces) and `privacy.redactionsApplied`.

## Platform

Job file (Platform dashboard + job detail) shows a **Claim-ready packet**
section with refresh + JSON export. Exportable alongside custody / reports —
not a rendered PDF.

## Rules

1. **Never invent** dates, parties, damage, cause, frames, or quotes.
2. **Privacy redactions** apply to statements whose timestamps fall in stored
   `ai_findings.privacyRedactions` ranges (`[privacy redacted]`).
3. Keep this feature **separate** from proof-pack PDF work.

## Tests

`backend/test/claimReadyPacket.test.ts`
