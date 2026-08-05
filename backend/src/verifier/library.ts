/**
 * The Verifier's rules, without a database in sight.
 *
 * Everything here is a judgement the portal renders — is this clip trustworthy,
 * has it been analysed, does it need a person's attention, is this share still
 * good — and every one of them is the kind of rule that reads fine inline in a
 * route until the day two surfaces compute it differently. So they live once,
 * pure, and tested.
 *
 * The one rule that governs the rest, inherited from the proof verifier and
 * repeated here because this module is where reviewers' screens get their
 * colours: **unknown is not pass**. A clip whose checks could not run is
 * unverified, not clean, and nothing in this file is allowed to blur that.
 */

export type CheckVerdict = 'pass' | 'fail' | 'unknown';

export interface StoredCheck {
  key: string;
  verdict: CheckVerdict;
  detail: string;
}

/** One overall word for a clip's integrity: the worst thing any check found. */
export function integrityOf(checks: StoredCheck[] | null | undefined): CheckVerdict {
  if (!checks || checks.length === 0) return 'unknown';
  if (checks.some((c) => c.verdict === 'fail')) return 'fail';
  if (checks.some((c) => c.verdict === 'unknown')) return 'unknown';
  return 'pass';
}

/**
 * The check keys, as sentences a reviewer reads. The verifier stores keys and
 * details; the label is presentation, and it lives here so the portal and any
 * export agree on the words.
 */
export const CHECK_LABELS: Record<string, string> = {
  on_site: 'Filmed on site',
  same_day: 'Filmed on the day claimed',
  uploaded_promptly: 'Uploaded promptly',
  long_enough: 'Long enough to show the work',
  not_a_reupload: 'Not filed before',
  ordered: 'Before filmed before the after',
};

export function labelForCheck(key: string): string {
  // An unknown key renders as itself rather than vanishing — a check the UI
  // has never heard of is still a check somebody ran.
  return CHECK_LABELS[key] ?? key.replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ *
 * Analysis state
 * ------------------------------------------------------------------ */

/**
 * What the list's Analysis column says about one clip.
 *
 * `paired` matters: a before video is never analysed on its own — it is read
 * as one half of its day — and a list that renders it "not analysed" teaches
 * reviewers to distrust rows that are working exactly as designed.
 */
export type AnalysisState =
  | 'done'
  | 'queued'
  | 'failed'
  | 'skipped'
  | 'paired' // this is a before; its day has an after and the reading lives there
  | 'waiting_on_after'
  | 'none';

export function analysisStateOf(input: {
  phase: 'before' | 'after' | string;
  analysisStatus: string | null;
  hasAiSummary: boolean;
  /** Does the same party/day have an after clip filed? */
  dayHasAfter: boolean;
}): AnalysisState {
  if (input.phase === 'before') {
    // The before's own row never carries the reading. Where the day stands is
    // the after's business; this row only says whether one exists yet.
    return input.dayHasAfter ? 'paired' : 'waiting_on_after';
  }
  switch (input.analysisStatus) {
    case 'done':
      return 'done';
    case 'queued':
    case 'running':
      return 'queued';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default:
      // Rows written before the pipeline existed: the summary says whether a
      // reading happened, and its absence is honest 'none', not a failure.
      return input.hasAiSummary ? 'done' : 'none';
  }
}

/**
 * Should this clip surface in the Flagged view.
 *
 * Flagged means "a person should look", and three things earn it: integrity
 * that is not a clean pass, an after whose comparison found nothing changed or
 * could not be made, and an analysis that failed outright. A before waiting on
 * its after is not flagged — that is the normal shape of a morning.
 */
export function needsAttention(input: {
  integrity: CheckVerdict;
  analysis: AnalysisState;
  materialChange: string | null;
}): boolean {
  if (input.integrity !== 'pass') return true;
  if (input.analysis === 'failed') return true;
  if (input.analysis === 'done' && (input.materialChange === 'none' || input.materialChange === 'unclear')) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Shares
 * ------------------------------------------------------------------ */

export interface ShareRow {
  revoked_at: string | null;
  expires_at: string | null;
}

/**
 * Is this share still good, and if not, why not — because the person holding
 * a dead link gets told which kind of dead it is. "This link was revoked" and
 * "this link expired" prompt different phone calls.
 */
export function shareState(
  share: ShareRow | null | undefined,
  now: Date = new Date(),
): 'live' | 'revoked' | 'expired' | 'missing' {
  if (!share) return 'missing';
  if (share.revoked_at) return 'revoked';
  if (share.expires_at && Date.parse(share.expires_at) <= now.getTime()) return 'expired';
  return 'live';
}

/* ------------------------------------------------------------------ *
 * Serialization
 * ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** The list row the portal renders, computed once, the same for both doors. */
export function serializeEvidence(input: {
  proof: any;
  jobName: string | null;
  jobNumber: number | null;
  company: string | null;
  contactName: string | null;
  tier: number | null;
  dayHasAfter: boolean;
}) {
  const proof = input.proof;
  const checks: StoredCheck[] = Array.isArray(proof.checks) ? proof.checks : [];
  const findings = proof.ai_findings ?? {};
  const analysis = analysisStateOf({
    phase: proof.phase,
    analysisStatus: proof.analysis_status ?? null,
    hasAiSummary: Boolean(proof.ai_summary),
    dayHasAfter: input.dayHasAfter,
  });
  const integrity = integrityOf(checks);
  const materialChange = proof.ai_material_change ?? findings.materialChange ?? null;

  return {
    id: proof.id,
    jobId: proof.job_id,
    jobName: input.jobName,
    jobNumber: input.jobNumber,
    partyId: proof.party_id,
    company: input.company,
    person: input.contactName,
    phase: proof.phase,
    workDate: proof.work_date,
    capturedAt: proof.captured_at,
    uploadedAt: proof.received_at,
    durationSeconds: proof.duration_seconds === null ? null : Number(proof.duration_seconds),
    byteSize: proof.byte_size === null ? null : Number(proof.byte_size),
    gps:
      proof.lat === null || proof.lat === undefined
        ? null
        : { lat: proof.lat, lon: proof.lon, accuracyM: proof.accuracy_m },
    hash: proof.content_hash,
    state: proof.state,
    tier: input.tier ?? 1,
    integrity,
    // Labels attached here so every consumer prints the same sentence.
    checks: checks.map((c) => ({ verdict: c.verdict, what: labelForCheck(c.key), detail: c.detail })),
    analysisState: analysis,
    materialChange,
    flagged: needsAttention({ integrity, analysis, materialChange }),
    legalHold: Boolean(proof.legal_hold),
    retentionUntil: proof.retention_until ?? null,
    analysis:
      analysis === 'done'
        ? {
            summary: proof.ai_summary ?? findings.summary ?? null,
            materialChange,
            materialBecause: findings.materialBecause ?? null,
            changes: Array.isArray(findings.changes) ? findings.changes : [],
            scope: Array.isArray(findings.scopeVerdicts)
              ? findings.scopeVerdicts.map((v: any) => ({ title: v.title, verdict: v.verdict }))
              : [],
            couldNotTell: Array.isArray(findings.cannotTell) ? findings.cannotTell : [],
            concerns: Array.isArray(findings.concerns) ? findings.concerns : [],
            /** Whether each clip opened at the property, as the guide asks. */
            opening: findings.opening ?? null,
            model: proof.ai_model ?? null,
          }
        : null,
  };
}
