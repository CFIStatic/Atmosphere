/**
 * Claim-ready packet — structure job evidence into carrier-ish fields.
 *
 * Zero-to-one: JSON document a desk examiner can skim. Only fields with
 * supporting evidence are filled. Null / empty means not evidenced — never
 * invent a date, party, damage, cause, photo, or quote.
 *
 * Separate from proof-pack PDF (if/when that ships). This is structured data
 * + Platform section / export alongside reports — not a rendered PDF.
 *
 * Privacy redactions are applied to speech / quotes whose timestamps fall
 * inside stored ranges before the packet leaves the builder.
 */

import {
  conversationFromStored,
  type ConversationDetails,
  type ConversationQuotedFact,
  type ConversationTurn,
} from '../audio/conversationDetails.js';
import { buildEvidenceLog, type EvidenceLogEntry } from '../audio/evidenceLog.js';
import {
  PRIVACY_REDACTED_LABEL,
  applyPrivacyToEvidenceEntries,
  privacyRedactionsFromStored,
  secondsInPrivacyRange,
  type PrivacyRedactionRange,
} from '../audio/privacyRedactions.js';
import { extractPeoplePresent } from '../audio/peoplePresent.js';

export const CLAIM_READY_PACKET_SCHEMA = 'atmosphere.claim_ready_packet.v1' as const;

export const CLAIM_READY_DISCLAIMER =
  'Only fields with supporting evidence are filled. Null or empty means not evidenced on this job file — Atmosphere never invents claim facts.';

export type ClaimReadyParty = {
  id: string;
  company: string | null;
  contactName: string | null;
  trade: string | null;
};

export type ClaimReadyObservation = {
  text: string;
  kind: 'damage' | 'observation' | 'material_change' | 'scope';
  sourceProofId: string | null;
  workDate: string | null;
  atSeconds: number | null;
  confidence: number | null;
};

export type ClaimReadyCause = {
  text: string;
  sourceProofId: string | null;
  workDate: string | null;
  atSeconds: number | null;
  quote: string | null;
};

export type ClaimReadyFrame = {
  proofId: string;
  workDate: string | null;
  phase: string | null;
  atSeconds: number;
  /** Storage object path when known — clients mint signed URLs; not inventable. */
  storagePath: string | null;
};

export type ClaimReadyStatement = {
  speakerLabel: string | null;
  text: string;
  quote: string | null;
  atSeconds: number | null;
  proofId: string;
  workDate: string | null;
  privacyRedacted: boolean;
};

export type ClaimReadyClipSummary = {
  proofId: string;
  workDate: string | null;
  phase: string | null;
  capturedAt: string | null;
  partyId: string | null;
  company: string | null;
  summary: string | null;
  materialChange: string | null;
  frameCount: number;
  statementCount: number;
  privacyRangeCount: number;
};

export type ClaimReadyPacket = {
  schema: typeof CLAIM_READY_PACKET_SCHEMA;
  exportedAt: string;
  disclaimer: typeof CLAIM_READY_DISCLAIMER;
  job: {
    id: string;
    number: number | null;
    name: string | null;
    claimNumber: string | null;
    policyNumber: string | null;
    lossType: string | null;
    siteAddress: string | null;
  };
  /** Distinct work_date values from filed proofs — never invented calendar days. */
  datesOnSite: string[];
  parties: ClaimReadyParty[];
  damageObservations: ClaimReadyObservation[];
  /** Filled only when speech/analysis explicitly evidences a cause. */
  cause: ClaimReadyCause | null;
  photosFrames: ClaimReadyFrame[];
  statements: ClaimReadyStatement[];
  clips: ClaimReadyClipSummary[];
  /** Honest gaps — what a carrier packet still lacks on this file. */
  gaps: string[];
  privacy: {
    redactionsApplied: boolean;
    rangeCount: number;
  };
};

function clean(value: unknown, max = 400): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return trimmed || null;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function findingsOf(row: { ai_findings?: unknown; aiFindings?: unknown }): Record<string, unknown> {
  const raw = row.ai_findings ?? row.aiFindings;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

const DAMAGE_RE =
  /\b(damage|damaged|storm|hail|wind|leak|leaking|water.?stain|flood|mold|mould|fire|smoke|collapse|hole|crack|broken|missing shingles?|torn|debris)\b/i;
const CAUSE_RE =
  /\b(cause[d]? by|caused from|from the|due to|because of|result of|origin of loss|peril)\b/i;

function looksLikeDamage(text: string): boolean {
  return DAMAGE_RE.test(text);
}

function looksLikeCause(text: string): boolean {
  return CAUSE_RE.test(text) || /\b(hail|wind.?driven|storm.?surge|pipe.?burst|appliance.?leak)\b/i.test(text);
}

function conversationOf(row: any): ConversationDetails {
  const findings = findingsOf(row);
  return conversationFromStored(
    typeof row.transcript_text === 'string' ? row.transcript_text : null,
    findings.conversation,
  );
}

function privacyOf(row: any): PrivacyRedactionRange[] {
  const findings = findingsOf(row);
  return privacyRedactionsFromStored(findings.privacyRedactions);
}

function evidenceEntriesOf(row: any): EvidenceLogEntry[] {
  const findings = findingsOf(row);
  const conversation = conversationOf(row);
  const people = extractPeoplePresent({
    conversation,
    transcript: typeof row.transcript_text === 'string' ? row.transcript_text : null,
    narrationText: typeof row.narration_text === 'string' ? row.narration_text : null,
    summary: typeof row.ai_summary === 'string' ? row.ai_summary : null,
    visionPeople: findings.people,
    actions: Array.isArray(row.actions)
      ? row.actions
      : Array.isArray(findings.actions)
        ? (findings.actions as Array<{ atSeconds?: number; description?: string; room?: string | null }>)
        : [],
  });
  return buildEvidenceLog({
    storedLog: findings.evidenceLog,
    storedEntries: findings.dictationEntries,
    conversation,
    people,
    actions: Array.isArray(row.actions)
      ? row.actions
      : Array.isArray(findings.actions)
        ? (findings.actions as Array<{ atSeconds?: number; description?: string; action?: string; room?: string | null }>)
        : [],
    summary: typeof row.ai_summary === 'string' ? row.ai_summary : null,
    narrationText: typeof row.narration_text === 'string' ? row.narration_text : null,
    durationSeconds: asNumber(row.duration_seconds ?? row.durationSeconds),
    transcript: typeof row.transcript_text === 'string' ? row.transcript_text : null,
  });
}

function redactStatementText(
  text: string,
  atSeconds: number | null,
  ranges: PrivacyRedactionRange[],
): { text: string; privacyRedacted: boolean } {
  if (atSeconds != null && secondsInPrivacyRange(atSeconds, ranges)) {
    return { text: PRIVACY_REDACTED_LABEL, privacyRedacted: true };
  }
  return { text, privacyRedacted: false };
}

function rawStoredTurns(row: any): ConversationTurn[] {
  const findings = findingsOf(row);
  const stored = findings.conversation;
  if (!stored || typeof stored !== 'object') return [];
  const turns = (stored as { turns?: unknown }).turns;
  if (!Array.isArray(turns)) return [];
  const out: ConversationTurn[] = [];
  for (const item of turns) {
    if (!item || typeof item !== 'object') continue;
    const text = clean((item as { text?: unknown }).text, 500);
    if (!text) continue;
    const speakerLabel = clean((item as { speakerLabel?: unknown }).speakerLabel, 80);
    const tSec = asNumber(
      (item as { tSec?: unknown; atSeconds?: unknown }).tSec ??
        (item as { atSeconds?: unknown }).atSeconds,
    );
    out.push({ tSec, speakerLabel: speakerLabel ?? 'Speaker', text });
  }
  return out;
}

function statementsFromClip(row: any, ranges: PrivacyRedactionRange[]): ClaimReadyStatement[] {
  const proofId = String(row.id);
  const workDate = clean(row.work_date ?? row.workDate, 32);
  const out: ClaimReadyStatement[] = [];
  const seen = new Set<string>();

  const push = (speakerLabel: string | null, text: string, quote: string | null, atSeconds: number | null) => {
    const body = clean(text, 500);
    if (!body) return;
    const redacted = redactStatementText(body, atSeconds, ranges);
    const qRaw = clean(quote, 400);
    const q =
      redacted.privacyRedacted && qRaw
        ? PRIVACY_REDACTED_LABEL
        : qRaw && atSeconds != null && secondsInPrivacyRange(atSeconds, ranges)
          ? PRIVACY_REDACTED_LABEL
          : qRaw;
    const key = `${atSeconds ?? ''}|${redacted.text}|${speakerLabel ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      speakerLabel: clean(speakerLabel, 80),
      text: redacted.text,
      quote: q,
      atSeconds,
      proofId,
      workDate,
      privacyRedacted: redacted.privacyRedacted || q === PRIVACY_REDACTED_LABEL,
    });
  };

  const conversation = conversationOf(row);
  const turns =
    (conversation.turns?.length ? conversation.turns : null) ?? rawStoredTurns(row);
  for (const turn of turns) {
    const t = turn as ConversationTurn;
    push(t.speakerLabel ?? null, t.text, null, asNumber(t.tSec));
  }

  const factBuckets: ConversationQuotedFact[][] = [
    conversation.agreementFacts ?? [],
    conversation.concernFacts ?? [],
    conversation.commitments ?? [],
    conversation.insurance ?? [],
    conversation.safety ?? [],
  ];
  for (const bucket of factBuckets) {
    for (const fact of bucket) {
      push(fact.owner ?? null, fact.text, fact.quote ?? null, asNumber(fact.tSec));
    }
  }

  let entries = evidenceEntriesOf(row);
  entries = applyPrivacyToEvidenceEntries(entries, ranges);
  for (const entry of entries) {
    if (entry.type !== 'said' && entry.type !== 'speech' && entry.type !== 'decision') continue;
    push(entry.speakerLabel ?? null, entry.text, entry.quote ?? null, asNumber(entry.atSeconds));
  }

  out.sort((a, b) => (a.atSeconds ?? 0) - (b.atSeconds ?? 0));
  return out.slice(0, 200);
}

function observationsFromClip(row: any, ranges: PrivacyRedactionRange[]): ClaimReadyObservation[] {
  const proofId = String(row.id);
  const workDate = clean(row.work_date ?? row.workDate, 32);
  const out: ClaimReadyObservation[] = [];
  const seen = new Set<string>();

  const push = (
    text: string,
    kind: ClaimReadyObservation['kind'],
    atSeconds: number | null,
    confidence: number | null,
  ) => {
    const body = clean(text, 500);
    if (!body) return;
    if (atSeconds != null && secondsInPrivacyRange(atSeconds, ranges) && isPrivateish(body)) {
      return;
    }
    const key = `${kind}|${body}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      text: body,
      kind,
      sourceProofId: proofId,
      workDate,
      atSeconds,
      confidence,
    });
  };

  const material =
    clean(row.ai_material_change ?? row.materialChange ?? findingsOf(row).materialChange, 40);
  const summary = clean(row.ai_summary ?? row.narration_text, 500);
  if (material && material !== 'none' && material !== 'unclear') {
    push(
      summary ? `Material change (${material}): ${summary}` : `Material change evidenced: ${material}`,
      'material_change',
      null,
      null,
    );
  }

  let entries = evidenceEntriesOf(row);
  entries = applyPrivacyToEvidenceEntries(entries, ranges);
  for (const entry of entries) {
    const type = String(entry.type || '').toLowerCase();
    if (type === 'said' || type === 'speech') continue;
    const text = entry.text;
    if (looksLikeDamage(text)) {
      push(text, 'damage', asNumber(entry.atSeconds), asNumber(entry.confidence));
    } else if (type === 'work' || type === 'scene' || type === 'activity') {
      push(text, 'observation', asNumber(entry.atSeconds), asNumber(entry.confidence));
    }
  }

  const conversation = conversationOf(row);
  for (const concern of conversation.concernFacts ?? []) {
    if (looksLikeDamage(concern.text) || looksLikeDamage(concern.quote ?? '')) {
      push(concern.text, 'damage', asNumber(concern.tSec), asNumber(concern.confidence));
    }
  }

  return out.slice(0, 100);
}

function isPrivateish(text: string): boolean {
  return /bathroom|toilet|shower|undress|nudity|changing room|locker/i.test(text);
}

function causeFromClips(
  rows: any[],
): ClaimReadyCause | null {
  for (const row of rows) {
    const ranges = privacyOf(row);
    const conversation = conversationOf(row);
    const candidates: ConversationQuotedFact[] = [
      ...(conversation.insurance ?? []),
      ...(conversation.concernFacts ?? []),
      ...(conversation.agreementFacts ?? []),
      ...(conversation.keyMoments ?? []).map((k) => ({
        text: k.text,
        tSec: k.tSec,
        quote: k.quote,
        confidence: k.confidence,
      })),
    ];
    for (const fact of candidates) {
      const text = clean(fact.text, 500);
      if (!text || !looksLikeCause(text)) continue;
      const at = asNumber(fact.tSec);
      if (at != null && secondsInPrivacyRange(at, ranges)) continue;
      const quote = clean(fact.quote, 400);
      return {
        text,
        sourceProofId: String(row.id),
        workDate: clean(row.work_date ?? row.workDate, 32),
        atSeconds: at,
        quote:
          quote && at != null && secondsInPrivacyRange(at, ranges) ? PRIVACY_REDACTED_LABEL : quote,
      };
    }
  }
  return null;
}

function framesForProof(
  proofId: string,
  workDate: string | null,
  phase: string | null,
  frames: Array<{ proof_id?: string; proofId?: string; at_seconds?: number; atSeconds?: number; storage_path?: string | null; storagePath?: string | null }>,
): ClaimReadyFrame[] {
  const out: ClaimReadyFrame[] = [];
  for (const frame of frames) {
    const pid = String(frame.proof_id ?? frame.proofId ?? '');
    if (pid !== proofId) continue;
    const at = asNumber(frame.at_seconds ?? frame.atSeconds);
    if (at == null) continue;
    out.push({
      proofId,
      workDate,
      phase,
      atSeconds: at,
      storagePath: clean(frame.storage_path ?? frame.storagePath, 500),
    });
  }
  return out;
}

function computeGaps(packet: Omit<ClaimReadyPacket, 'gaps' | 'privacy' | 'schema' | 'exportedAt' | 'disclaimer'> & {
  privacyRangeCount: number;
}): string[] {
  const gaps: string[] = [];
  if (!packet.datesOnSite.length) gaps.push('No filed video work dates on site.');
  if (!packet.parties.length) gaps.push('No parties invited on this job file.');
  if (!packet.damageObservations.length) gaps.push('No damage or visual observations extracted from evidence yet.');
  if (!packet.cause) gaps.push('No evidenced cause of loss in speech or analysis.');
  if (!packet.photosFrames.length) gaps.push('No still frames on file for photo exhibits.');
  if (!packet.statements.length) gaps.push('No timed statements (who said what) on file.');
  if (!packet.job.claimNumber) gaps.push('Claim number not set on the job.');
  if (!packet.job.siteAddress) gaps.push('Site address not on the property record.');
  return gaps;
}

export function buildClaimReadyPacket(input: {
  exportedAt?: string;
  job: {
    id: string;
    number?: number | null;
    name?: string | null;
    claimNumber?: string | null;
    policyNumber?: string | null;
    lossType?: string | null;
    siteAddress?: string | null;
  };
  parties?: Array<{
    id: string;
    company?: string | null;
    contact_name?: string | null;
    contactName?: string | null;
    trade?: string | null;
    revoked_at?: string | null;
  }>;
  proofs?: any[];
  frames?: Array<{
    proof_id?: string;
    proofId?: string;
    at_seconds?: number;
    atSeconds?: number;
    storage_path?: string | null;
    storagePath?: string | null;
  }>;
  scopeItems?: Array<{ title?: string | null; state?: string | null; reason?: string | null }>;
}): ClaimReadyPacket {
  const proofs = (input.proofs ?? []).filter((p) => p && p.id);
  const frames = input.frames ?? [];
  const parties: ClaimReadyParty[] = (input.parties ?? [])
    .filter((p) => p && p.id && !p.revoked_at)
    .map((p) => ({
      id: String(p.id),
      company: clean(p.company, 160),
      contactName: clean(p.contactName ?? p.contact_name, 120),
      trade: clean(p.trade, 80),
    }));

  const datesOnSite = [
    ...new Set(
      proofs
        .map((p) => clean(p.work_date ?? p.workDate, 32))
        .filter((d): d is string => Boolean(d)),
    ),
  ].sort();

  const damageObservations: ClaimReadyObservation[] = [];
  const statements: ClaimReadyStatement[] = [];
  const photosFrames: ClaimReadyFrame[] = [];
  const clips: ClaimReadyClipSummary[] = [];
  let privacyRangeCount = 0;

  for (const row of proofs) {
    const ranges = privacyOf(row);
    privacyRangeCount += ranges.length;
    const obs = observationsFromClip(row, ranges);
    damageObservations.push(...obs);
    const said = statementsFromClip(row, ranges);
    statements.push(...said);
    const workDate = clean(row.work_date ?? row.workDate, 32);
    const phase = clean(row.phase, 40);
    const clipFrames = framesForProof(String(row.id), workDate, phase, frames);
    photosFrames.push(...clipFrames);
    clips.push({
      proofId: String(row.id),
      workDate,
      phase,
      capturedAt: clean(row.captured_at ?? row.capturedAt, 40),
      partyId: clean(row.party_id ?? row.partyId, 64),
      company: clean(row.company, 160),
      summary: clean(row.ai_summary ?? row.narration_text, 500),
      materialChange: clean(row.ai_material_change ?? findingsOf(row).materialChange, 40),
      frameCount: clipFrames.length,
      statementCount: said.length,
      privacyRangeCount: ranges.length,
    });
  }

  for (const item of input.scopeItems ?? []) {
    const title = clean(item.title, 200);
    const reason = clean(item.reason, 400);
    if (!title) continue;
    if (reason && looksLikeDamage(reason)) {
      damageObservations.push({
        text: `${title}: ${reason}`,
        kind: 'scope',
        sourceProofId: null,
        workDate: null,
        atSeconds: null,
        confidence: null,
      });
    } else if (looksLikeDamage(title)) {
      damageObservations.push({
        text: title,
        kind: 'scope',
        sourceProofId: null,
        workDate: null,
        atSeconds: null,
        confidence: null,
      });
    }
  }

  const job = {
    id: input.job.id,
    number: input.job.number ?? null,
    name: clean(input.job.name, 200),
    claimNumber: clean(input.job.claimNumber, 80),
    policyNumber: clean(input.job.policyNumber, 80),
    lossType: clean(input.job.lossType, 80),
    siteAddress: clean(input.job.siteAddress, 240),
  };

  const cause = causeFromClips(proofs);

  const base = {
    job,
    datesOnSite,
    parties,
    damageObservations: damageObservations.slice(0, 200),
    cause,
    photosFrames: photosFrames.slice(0, 500),
    statements: statements.slice(0, 400),
    clips,
    privacyRangeCount,
  };

  return {
    schema: CLAIM_READY_PACKET_SCHEMA,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    disclaimer: CLAIM_READY_DISCLAIMER,
    job,
    datesOnSite,
    parties,
    damageObservations: base.damageObservations,
    cause,
    photosFrames: base.photosFrames,
    statements: base.statements,
    clips,
    gaps: computeGaps(base),
    privacy: {
      redactionsApplied: privacyRangeCount > 0,
      rangeCount: privacyRangeCount,
    },
  };
}

export function isClaimReadyPacket(value: unknown): value is ClaimReadyPacket {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return rec.schema === CLAIM_READY_PACKET_SCHEMA && typeof rec.job === 'object' && rec.job != null;
}
