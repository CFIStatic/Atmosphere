/**
 * Job proof pack — structured report model for insurers / GC / homeowners.
 *
 * What happened, who was there, decisions, next steps, timed quotes, and
 * key-frame slots. Privacy-redacted ranges never leak private frames or quotes.
 */

import {
  PRIVACY_REDACTED_LABEL,
  privacyRedactionsFromStored,
  secondsInPrivacyRange,
  type PrivacyRedactionRange,
} from '../audio/privacyRedactions.js';

export const JOB_PROOF_PACK_SCHEMA = 'atmosphere.job_proof_pack.v1' as const;

export type ProofPackQuote = {
  tSec: number | null;
  speaker: string | null;
  text: string;
  kind: string;
  quote: string | null;
};

export type ProofPackFrameSlot = {
  proofId: string;
  atSeconds: number;
  storagePath: string | null;
  /** Filled by the route after download; omitted from JSON previews. */
  jpeg?: Buffer | null;
};

export type ProofPackClip = {
  id: string;
  workDate: string;
  phase: string;
  company: string;
  person: string | null;
  summary: string | null;
  people: string[];
  whatHappened: string[];
  decisions: ProofPackQuote[];
  nextSteps: ProofPackQuote[];
  quotes: ProofPackQuote[];
  frames: ProofPackFrameSlot[];
  privacyRangesRedacted: number;
};

export type ProofPackDay = {
  workDate: string;
  company: string;
  partyId: string;
  summary: string | null;
  aiSummary: string | null;
  decision: 'accepted' | 'rejected' | 'pending';
  payable: boolean;
  payableBecause: string;
  materialChange: string | null;
  concerns: string[];
  nextSteps: string[];
  clipIds: string[];
};

export type JobProofPack = {
  schema: typeof JOB_PROOF_PACK_SCHEMA;
  exportedAt: string;
  workDateFilter: string | null;
  job: {
    id: string;
    number: number | null;
    name: string | null;
    claimNumber: string | null;
    address: string | null;
    workType: string | null;
  };
  overview: {
    whatHappened: string[];
    who: string[];
    decisions: string[];
    nextSteps: string[];
  };
  days: ProofPackDay[];
  clips: ProofPackClip[];
  disputes: Array<{
    title: string;
    detail: string;
    severity: string;
    workDate: string | null;
    seekSeconds: number | null;
  }>;
  /** Open items from film analysis — never invented. Empty when none on file. */
  punchList: Array<{
    text: string;
    detail: string | null;
    source: string;
    seekSeconds: number | null;
    workDate: string | null;
    company: string | null;
    ownerLabel: string | null;
    proofId: string | null;
  }>;
  privacyNotice: string;
};

function clean(value: unknown, max = 800): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return trimmed || null;
}

function uniqueStrings(values: Array<string | null | undefined>, max = 24): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = clean(raw, 400);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function asFactList(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>>;
}

function quoteFromFact(
  fact: Record<string, unknown>,
  kind: string,
  ranges: PrivacyRedactionRange[],
): ProofPackQuote | null {
  const text = clean(fact.text ?? fact.label, 400);
  if (!text) return null;
  const tSecRaw = fact.tSec ?? fact.atSeconds ?? fact.seekSeconds;
  const tSec =
    tSecRaw == null || tSecRaw === ''
      ? null
      : Number.isFinite(Number(tSecRaw))
        ? Number(tSecRaw)
        : null;
  const quote = clean(fact.quote, 400);
  if (tSec != null && secondsInPrivacyRange(tSec, ranges)) {
    return {
      tSec,
      speaker: clean(fact.owner ?? fact.speakerLabel, 80),
      text: PRIVACY_REDACTED_LABEL,
      kind,
      quote: PRIVACY_REDACTED_LABEL,
    };
  }
  if (text === PRIVACY_REDACTED_LABEL || quote === PRIVACY_REDACTED_LABEL) {
    return {
      tSec,
      speaker: clean(fact.owner ?? fact.speakerLabel, 80),
      text: PRIVACY_REDACTED_LABEL,
      kind,
      quote: PRIVACY_REDACTED_LABEL,
    };
  }
  return {
    tSec,
    speaker: clean(fact.owner ?? fact.speakerLabel, 80),
    text,
    kind,
    quote,
  };
}

function collectQuotes(
  conversation: Record<string, unknown> | null | undefined,
  evidenceLog: Array<Record<string, unknown>> | null | undefined,
  ranges: PrivacyRedactionRange[],
): { quotes: ProofPackQuote[]; decisions: ProofPackQuote[]; nextSteps: ProofPackQuote[] } {
  const quotes: ProofPackQuote[] = [];
  const decisions: ProofPackQuote[] = [];
  const nextSteps: ProofPackQuote[] = [];

  const push = (bucket: ProofPackQuote[], fact: Record<string, unknown>, kind: string) => {
    const q = quoteFromFact(fact, kind, ranges);
    if (!q) return;
    if (q.text === PRIVACY_REDACTED_LABEL) return; // omit private content entirely from the pack
    bucket.push(q);
  };

  if (conversation) {
    for (const fact of asFactList(conversation.conversationAgreementFacts)) {
      push(decisions, fact, 'agreement');
      push(quotes, fact, 'agreement');
    }
    for (const fact of asFactList(conversation.conversationCommitments)) {
      push(decisions, fact, 'commitment');
      push(quotes, fact, 'commitment');
    }
    for (const fact of asFactList(conversation.conversationActionItems)) {
      push(nextSteps, fact, 'action');
      push(quotes, fact, 'action');
    }
    for (const fact of asFactList(conversation.conversationUnresolvedQuestions)) {
      push(nextSteps, fact, 'unresolved');
      push(quotes, fact, 'unresolved');
    }
    for (const fact of asFactList(conversation.conversationConcernFacts)) {
      push(quotes, fact, 'concern');
    }
    for (const fact of asFactList(conversation.conversationKeyMoments)) {
      push(quotes, { ...fact, text: fact.text ?? fact.label }, 'moment');
    }
    for (const turn of asFactList(conversation.conversationTurns).slice(0, 40)) {
      push(
        quotes,
        {
          text: turn.text,
          tSec: turn.tSec,
          speakerLabel: turn.speakerLabel,
          quote: turn.text,
        },
        'said',
      );
    }
  }

  for (const entry of evidenceLog ?? []) {
    const type = String(entry.type || '').toLowerCase();
    if (type !== 'said' && type !== 'decision' && type !== 'speech') continue;
    push(
      type === 'decision' ? decisions : quotes,
      {
        text: entry.quote ?? entry.text,
        tSec: entry.atSeconds,
        speakerLabel: entry.speakerLabel,
        quote: entry.quote ?? entry.text,
        owner: entry.owner,
      },
      type,
    );
  }

  const dedupe = (list: ProofPackQuote[], max: number) => {
    const out: ProofPackQuote[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const key = `${item.tSec ?? ''}|${item.kind}|${item.text.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= max) break;
    }
    return out;
  };

  return {
    quotes: dedupe(quotes, 40),
    decisions: dedupe(decisions, 16),
    nextSteps: dedupe(nextSteps, 16),
  };
}

function peopleNames(peoplePayload: unknown): string[] {
  if (!peoplePayload || typeof peoplePayload !== 'object') return [];
  const people = (peoplePayload as { people?: unknown }).people;
  if (!Array.isArray(people)) return [];
  return uniqueStrings(
    people.map((p) => {
      if (!p || typeof p !== 'object') return null;
      const row = p as Record<string, unknown>;
      return clean(row.displayName ?? row.label ?? row.name ?? row.role, 80);
    }),
    12,
  );
}

function whatFromFindings(findings: Record<string, unknown> | null | undefined): string[] {
  if (!findings) return [];
  return uniqueStrings(
    [
      ...(Array.isArray(findings.workPerformed) ? findings.workPerformed : []),
      ...(Array.isArray(findings.changes) ? findings.changes : []),
      ...(Array.isArray(findings.scopeTouched) ? findings.scopeTouched : []),
    ].map((v) => (typeof v === 'string' ? v : null)),
    12,
  );
}

function concernsFromFindings(findings: Record<string, unknown> | null | undefined): string[] {
  if (!findings) return [];
  return uniqueStrings(
    [
      ...(Array.isArray(findings.concerns) ? findings.concerns : []),
      ...(Array.isArray(findings.cannotTell) ? findings.cannotTell : []),
    ].map((v) => (typeof v === 'string' ? v : null)),
    10,
  );
}

export function formatProofPackClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const n = Math.max(0, Math.floor(seconds));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type ProofPackVideoInput = {
  id: string;
  workDate: string;
  phase?: string | null;
  company?: string | null;
  person?: string | null;
  aiSummary?: string | null;
  conversation?: Record<string, unknown> | null;
  evidenceLog?: Array<Record<string, unknown>> | null;
  people?: unknown;
  privacyRedactions?: unknown;
};

export type ProofPackDayInput = {
  partyId: string;
  company: string;
  workDate: string;
  summary?: string | null;
  aiSummary?: string | null;
  accepted?: boolean;
  rejected?: boolean;
  payable?: boolean;
  payableBecause?: string | null;
  materialChange?: string | null;
  aiFindings?: Record<string, unknown> | null;
  proofIds?: string[];
};

export type ProofPackFrameInput = {
  proofId: string;
  atSeconds: number;
  storagePath: string | null;
};

/**
 * Pick evenly spaced public frames for a clip (skip privacy ranges).
 */
export function selectPublicFrames(
  frames: ProofPackFrameInput[],
  ranges: PrivacyRedactionRange[],
  limit = 4,
): ProofPackFrameSlot[] {
  const publicFrames = frames
    .filter((f) => Number.isFinite(f.atSeconds) && f.atSeconds >= 0)
    .filter((f) => !secondsInPrivacyRange(f.atSeconds, ranges))
    .sort((a, b) => a.atSeconds - b.atSeconds);
  if (!publicFrames.length || limit <= 0) return [];
  if (publicFrames.length <= limit) {
    return publicFrames.map((f) => ({
      proofId: f.proofId,
      atSeconds: f.atSeconds,
      storagePath: f.storagePath,
    }));
  }
  const out: ProofPackFrameSlot[] = [];
  for (let i = 0; i < limit; i++) {
    const idx = Math.round((i * (publicFrames.length - 1)) / (limit - 1));
    const frame = publicFrames[idx]!;
    if (out.some((prev) => prev.atSeconds === frame.atSeconds)) continue;
    out.push({
      proofId: frame.proofId,
      atSeconds: frame.atSeconds,
      storagePath: frame.storagePath,
    });
  }
  return out;
}

export function buildJobProofPack(input: {
  exportedAt?: string;
  workDateFilter?: string | null;
  job: {
    id: string;
    number?: number | null;
    name?: string | null;
    claimNumber?: string | null;
    address?: string | null;
    workType?: string | null;
  };
  days: ProofPackDayInput[];
  videos: ProofPackVideoInput[];
  disputes?: Array<{
    title?: string;
    detail?: string;
    severity?: string;
    workDate?: string | null;
    seekSeconds?: number | null;
  }>;
  punchList?: Array<{
    text?: string;
    detail?: string | null;
    source?: string;
    seekSeconds?: number | null;
    workDate?: string | null;
    company?: string | null;
    ownerLabel?: string | null;
    proofId?: string | null;
  }>;
  framesByProof?: Map<string, ProofPackFrameInput[]>;
}): JobProofPack {
  const workDateFilter = clean(input.workDateFilter, 32);
  const videos = input.videos.filter((v) =>
    workDateFilter ? String(v.workDate) === workDateFilter : true,
  );
  const days = input.days.filter((d) =>
    workDateFilter ? String(d.workDate) === workDateFilter : true,
  );

  const clips: ProofPackClip[] = videos.map((video) => {
    const ranges = privacyRedactionsFromStored(video.privacyRedactions);
    const collected = collectQuotes(
      video.conversation ?? null,
      (video.evidenceLog as Array<Record<string, unknown>> | null) ?? null,
      ranges,
    );
    const frames = selectPublicFrames(input.framesByProof?.get(video.id) ?? [], ranges, 4);
    return {
      id: video.id,
      workDate: String(video.workDate),
      phase: String(video.phase || 'unknown'),
      company: clean(video.company, 120) ?? 'Company',
      person: clean(video.person, 120),
      summary: clean(video.aiSummary, 1200),
      people: peopleNames(video.people),
      whatHappened: uniqueStrings([video.aiSummary], 6),
      decisions: collected.decisions,
      nextSteps: collected.nextSteps,
      quotes: collected.quotes,
      frames,
      privacyRangesRedacted: ranges.length,
    };
  });

  const packDays: ProofPackDay[] = days.map((day) => {
    const findings = day.aiFindings && typeof day.aiFindings === 'object' ? day.aiFindings : null;
    const decision: ProofPackDay['decision'] = day.accepted
      ? 'accepted'
      : day.rejected
        ? 'rejected'
        : 'pending';
    const nextFromFindings = uniqueStrings(
      [
        ...(Array.isArray(findings?.cannotTell) ? (findings!.cannotTell as unknown[]) : []),
        day.payable ? null : day.payableBecause,
      ].map((v) => (typeof v === 'string' ? v : null)),
      8,
    );
    return {
      workDate: String(day.workDate),
      company: clean(day.company, 120) ?? 'Company',
      partyId: day.partyId,
      summary: clean(day.summary, 800),
      aiSummary: clean(day.aiSummary, 1200),
      decision,
      payable: Boolean(day.payable),
      payableBecause: clean(day.payableBecause, 400) ?? '',
      materialChange: clean(day.materialChange, 40),
      concerns: concernsFromFindings(findings),
      nextSteps: nextFromFindings,
      clipIds: Array.isArray(day.proofIds) ? day.proofIds.map(String) : [],
    };
  });

  const overviewWhat = uniqueStrings(
    [
      ...packDays.map((d) => d.aiSummary ?? d.summary),
      ...clips.flatMap((c) => c.whatHappened),
      ...clips.map((c) => c.summary),
      ...days.flatMap((d) => whatFromFindings(d.aiFindings ?? null)),
    ],
    12,
  );
  const overviewWho = uniqueStrings(
    [
      ...clips.flatMap((c) => [
        c.person ? `${c.person} (${c.company})` : c.company,
        ...c.people,
      ]),
      ...packDays.map((d) => d.company),
    ],
    16,
  );
  const overviewDecisions = uniqueStrings(
    [
      ...packDays.map((d) => {
        if (d.decision === 'accepted') return `${d.workDate} · ${d.company}: accepted`;
        if (d.decision === 'rejected') return `${d.workDate} · ${d.company}: rejected`;
        return null;
      }),
      ...clips.flatMap((c) => c.decisions.map((q) => q.text)),
      ...packDays.flatMap((d) => d.concerns.map((c) => `Concern: ${c}`)),
    ],
    16,
  );
  const overviewNext = uniqueStrings(
    [
      ...packDays.flatMap((d) => d.nextSteps),
      ...clips.flatMap((c) => c.nextSteps.map((q) => q.text)),
      ...packDays
        .filter((d) => d.decision === 'pending')
        .map((d) => `${d.workDate} · ${d.company}: awaiting decision`),
    ],
    16,
  );

  const disputes = (input.disputes ?? [])
    .filter((d) => (workDateFilter ? !d.workDate || d.workDate === workDateFilter : true))
    .map((d) => ({
      title: clean(d.title, 200) ?? 'Dispute',
      detail: clean(d.detail, 600) ?? '',
      severity: clean(d.severity, 40) ?? 'medium',
      workDate: d.workDate ?? null,
      seekSeconds:
        d.seekSeconds == null || !Number.isFinite(Number(d.seekSeconds))
          ? null
          : Number(d.seekSeconds),
    }))
    .slice(0, 30);

  const punchList = (input.punchList ?? [])
    .filter((p) => (workDateFilter ? !p.workDate || p.workDate === workDateFilter : true))
    .map((p) => ({
      text: clean(p.text, 280) ?? '',
      detail: clean(p.detail, 600),
      source: clean(p.source, 40) ?? 'action',
      seekSeconds:
        p.seekSeconds == null || !Number.isFinite(Number(p.seekSeconds))
          ? null
          : Number(p.seekSeconds),
      workDate: p.workDate ?? null,
      company: clean(p.company, 120),
      ownerLabel: clean(p.ownerLabel, 80),
      proofId: p.proofId ?? null,
    }))
    .filter((p) => p.text)
    .slice(0, 80);

  const redactedRangeCount = clips.reduce((n, c) => n + c.privacyRangesRedacted, 0);

  return {
    schema: JOB_PROOF_PACK_SCHEMA,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    workDateFilter,
    job: {
      id: input.job.id,
      number: input.job.number ?? null,
      name: clean(input.job.name, 200),
      claimNumber: clean(input.job.claimNumber, 80),
      address: clean(input.job.address, 200),
      workType: clean(input.job.workType, 80),
    },
    overview: {
      whatHappened: overviewWhat,
      who: overviewWho,
      decisions: overviewDecisions,
      nextSteps: overviewNext,
    },
    days: packDays,
    clips,
    disputes,
    punchList,
    privacyNotice:
      redactedRangeCount > 0
        ? `Private moments were redacted (${redactedRangeCount} interval${redactedRangeCount === 1 ? '' : 's'}). Private frames and quotes are omitted from this report.`
        : 'No private-moment redactions were on file for the clips in this report.',
  };
}
