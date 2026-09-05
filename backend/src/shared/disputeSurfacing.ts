/**
 * Dispute surfacing — the GC money feature.
 *
 * From the footage already on file, name the moments that conflict with the
 * agreed scope or with each other. No new model call: this is composition of
 * integrity checks, scope verdicts, concerns, and event-boundary timestamps
 * that the analysis pipeline already stores.
 *
 * A before-clip saying a line is `not_visible` is not a dispute. An after
 * clip of a different house, or two after clips that disagree on the same
 * included line, is.
 */

import { labelForCheck } from '../verifier/library.js';
import { resolveDictationEntries, type DictationEvent } from './dictationEvents.js';

export const DISPUTE_SCHEMA = 'atmosphere.job_disputes.v1' as const;

export type DisputeKind = 'scope' | 'clip' | 'integrity';
export type DisputeSeverity = 'high' | 'medium';

export interface DisputeMoment {
  id: string;
  kind: DisputeKind;
  severity: DisputeSeverity;
  title: string;
  detail: string;
  proofId: string | null;
  seekSeconds: number | null;
  workDate: string | null;
  partyId: string | null;
  company: string | null;
  phase: string | null;
  relatedProofIds: string[];
  scopeTitle: string | null;
}

export interface DisputeScopeLine {
  title: string;
  state: string;
  reason?: string | null;
}

export interface DisputeClip {
  id: string;
  partyId?: string | null;
  company?: string | null;
  workDate: string;
  phase: string;
  checks?: Array<{ key?: string; verdict: string; what?: string; detail?: string }>;
  contradicted?: boolean;
  materialChange?: string | null;
  concerns?: string[];
  scopeVerdicts?: Array<{ title: string; verdict: string; because?: string | null }>;
  events?: Array<{ atSeconds: number; text: string }>;
  summary?: string | null;
  /** Raw stored narration — resolved into events when `events` is empty. */
  narrationEntries?: unknown;
  narrationText?: string | null;
}

const EXCLUDED_STATES = new Set(['excluded', 'declined']);
const AFTER_PHASES = new Set(['after', 'workday', 'day_film', 'walkthrough', 'pre-conceal']);
const OUT_OF_SCOPE = /\b(?:out of scope|outside (?:the )?(?:listed )?scope|not in scope|excluded)\b/i;
const GENERIC_CONCERN = /\b(?:hazard|damage|unsafe|mold|leak)\b/i;

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function titleTokens(title: string): string[] {
  return norm(title)
    .split(' ')
    .filter((w) => w.length > 2 && !/^(the|and|for|not|do|don)$/.test(w));
}

function tokenHit(hay: string, token: string): boolean {
  if (hay.includes(token)) return true;
  if (token.length < 5) return false;
  const stem = token.endsWith('s') ? token.slice(0, -1) : `${token}s`;
  return hay.includes(stem);
}

function mentionsTitle(hay: string, title: string): boolean {
  const n = norm(hay);
  const t = norm(title);
  if (!n || !t) return false;
  if (n.includes(t)) return true;
  const tokens = titleTokens(title);
  if (!tokens.length) return false;
  if (tokens.length === 1) return tokenHit(n, tokens[0]!);
  const hits = tokens.filter((tok) => tokenHit(n, tok)).length;
  return hits >= Math.min(2, Math.ceil(tokens.length * 0.5));
}

function isAfterish(phase: string): boolean {
  return AFTER_PHASES.has(String(phase || '').toLowerCase());
}

export function eventsForClip(clip: DisputeClip): DictationEvent[] {
  if (Array.isArray(clip.events) && clip.events.length) {
    return clip.events
      .filter((e) => Number.isFinite(e.atSeconds) && String(e.text || '').trim())
      .map((e) => ({ atSeconds: Number(e.atSeconds), text: String(e.text).trim() }));
  }
  return resolveDictationEntries({
    stored: clip.narrationEntries,
    narrationText: clip.narrationText ?? clip.summary ?? null,
    summary: clip.summary ?? null,
  });
}

/** First event whose copy talks about `needle`, else null — never a junk 0:00. */
export function seekSecondsFor(events: Array<{ atSeconds: number; text: string }>, needle?: string | null): number | null {
  if (!events.length) return null;
  if (needle) {
    const hit = events.find((e) => mentionsTitle(e.text, needle) && e.atSeconds > 0.51);
    if (hit) return hit.atSeconds;
    const any = events.find((e) => mentionsTitle(e.text, needle));
    if (any && any.atSeconds > 0.51) return any.atSeconds;
  }
  const firstReal = events.find((e) => e.atSeconds > 0.51);
  return firstReal ? firstReal.atSeconds : null;
}

function excludedLines(scope: DisputeScopeLine[] | undefined): DisputeScopeLine[] {
  return (scope ?? []).filter((line) => EXCLUDED_STATES.has(String(line.state || '').toLowerCase()));
}

function clipId(clip: DisputeClip, kind: string, extra: string): string {
  return `${kind}:${clip.id}:${extra}`.slice(0, 160);
}

function base(clip: DisputeClip): Pick<
  DisputeMoment,
  'proofId' | 'workDate' | 'partyId' | 'company' | 'phase' | 'relatedProofIds'
> {
  return {
    proofId: clip.id,
    workDate: clip.workDate ?? null,
    partyId: clip.partyId ?? null,
    company: clip.company ?? null,
    phase: clip.phase ?? null,
    relatedProofIds: [clip.id],
  };
}

function integrityDisputes(clip: DisputeClip, events: DictationEvent[]): DisputeMoment[] {
  const out: DisputeMoment[] = [];
  for (const check of clip.checks ?? []) {
    if (check.verdict !== 'fail') continue;
    const what = check.what || (check.key ? labelForCheck(check.key) : 'integrity check');
    out.push({
      id: clipId(clip, 'integrity', check.key || what),
      kind: 'integrity',
      severity: 'high',
      title: what,
      detail: check.detail?.trim() || `${what} failed.`,
      seekSeconds: seekSecondsFor(events, check.detail || what),
      scopeTitle: null,
      ...base(clip),
    });
  }
  if (clip.contradicted && !out.length) {
    out.push({
      id: clipId(clip, 'integrity', 'contradicted'),
      kind: 'integrity',
      severity: 'high',
      title: 'Footage is contradicted',
      detail: 'A check on this day failed — the record does not support the claim.',
      seekSeconds: seekSecondsFor(events),
      scopeTitle: null,
      ...base(clip),
    });
  }
  return out;
}

function scopeDisputes(
  clip: DisputeClip,
  events: DictationEvent[],
  excluded: DisputeScopeLine[],
): DisputeMoment[] {
  const out: DisputeMoment[] = [];
  const seen = new Set<string>();

  for (const line of excluded) {
    const verdict = (clip.scopeVerdicts ?? []).find((v) => norm(v.title) === norm(line.title));
    const visible = verdict && (verdict.verdict === 'appears_complete' || verdict.verdict === 'in_progress');
    const talked = events.some((e) => mentionsTitle(e.text, line.title));
    const concerned = (clip.concerns ?? []).some((c) => mentionsTitle(c, line.title));
    if (!visible && !talked && !concerned) continue;
    const key = norm(line.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: clipId(clip, 'scope', key),
      kind: 'scope',
      severity: 'high',
      title: `Conflicts with excluded scope — ${line.title}`,
      detail:
        verdict?.because?.trim() ||
        (clip.concerns ?? []).find((c) => mentionsTitle(c, line.title)) ||
        `This clip shows work on “${line.title}”, which is marked ${line.state} on the file.`,
      seekSeconds: seekSecondsFor(events, line.title),
      scopeTitle: line.title,
      ...base(clip),
    });
  }

  for (const concern of clip.concerns ?? []) {
    const text = String(concern || '').trim();
    if (!text) continue;
    if (!OUT_OF_SCOPE.test(text) && !excluded.some((line) => mentionsTitle(text, line.title))) {
      continue;
    }
    const matched = excluded.find((line) => mentionsTitle(text, line.title));
    const key = matched ? norm(matched.title) : `concern:${norm(text).slice(0, 48)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: clipId(clip, 'scope', key),
      kind: 'scope',
      severity: GENERIC_CONCERN.test(text) ? 'high' : 'medium',
      title: matched ? `Conflicts with excluded scope — ${matched.title}` : 'Work outside the agreed scope',
      detail: text,
      seekSeconds: seekSecondsFor(events, matched?.title || text),
      scopeTitle: matched?.title ?? null,
      ...base(clip),
    });
  }

  return out;
}

function clipConflicts(clips: DisputeClip[]): DisputeMoment[] {
  const after = clips.filter((c) => isAfterish(c.phase));
  const byTitle = new Map<string, Array<{ clip: DisputeClip; title: string; verdict: string; because?: string | null }>>();
  for (const clip of after) {
    for (const v of clip.scopeVerdicts ?? []) {
      if (!v.title || v.verdict === 'not_visible') continue;
      const key = norm(v.title);
      const list = byTitle.get(key) ?? [];
      list.push({ clip, title: v.title, verdict: v.verdict, because: v.because });
      byTitle.set(key, list);
    }
  }

  const out: DisputeMoment[] = [];
  for (const [, rows] of byTitle) {
    const complete = rows.filter((r) => r.verdict === 'appears_complete');
    const unfinished = rows.filter((r) => r.verdict === 'in_progress');
    if (!complete.length || !unfinished.length) continue;
    const ids = new Set(rows.map((r) => r.clip.id));
    if (ids.size < 2) continue;
    const later = [...unfinished].sort((a, b) => a.clip.workDate.localeCompare(b.clip.workDate)).at(-1)!;
    const earlier = complete.find((r) => r.clip.id !== later.clip.id) ?? complete[0]!;
    const events = eventsForClip(later.clip);
    const line = later.title;
    out.push({
      id: `clip:${[...ids].sort().join(',')}:${norm(line)}`,
      kind: 'clip',
      severity: 'high',
      title: `Clips disagree — ${line}`,
      detail:
        later.because?.trim() ||
        `${earlier.clip.workDate} reads finished; ${later.clip.workDate} still shows the line under way.`,
      proofId: later.clip.id,
      seekSeconds: seekSecondsFor(events, line),
      workDate: later.clip.workDate,
      partyId: later.clip.partyId ?? null,
      company: later.clip.company ?? null,
      phase: later.clip.phase,
      relatedProofIds: [...ids],
      scopeTitle: line,
    });
  }

  for (const clip of after) {
    if (clip.materialChange !== 'none') continue;
    const events = eventsForClip(clip);
    out.push({
      id: clipId(clip, 'clip', 'no-change'),
      kind: 'clip',
      severity: 'medium',
      title: 'Claimed day, no visible change',
      detail: 'The after footage looks like the before — nothing material changed in frame.',
      seekSeconds: seekSecondsFor(events),
      scopeTitle: null,
      ...base(clip),
    });
  }

  return out;
}

/**
 * Compose the disputed moments on a job. Stable order: integrity, then
 * scope, then clip-vs-clip. Duplicate ids collapse to the first.
 */
export function surfaceDisputes(input: {
  clips: DisputeClip[];
  scope?: DisputeScopeLine[];
}): DisputeMoment[] {
  const excluded = excludedLines(input.scope);
  const out: DisputeMoment[] = [];
  for (const clip of input.clips) {
    const events = eventsForClip(clip);
    out.push(...integrityDisputes(clip, events));
    out.push(...scopeDisputes(clip, events, excluded));
  }
  out.push(...clipConflicts(input.clips));

  const seen = new Set<string>();
  const unique: DisputeMoment[] = [];
  for (const moment of out) {
    if (seen.has(moment.id)) continue;
    seen.add(moment.id);
    unique.push(moment);
  }
  const rank = { integrity: 0, scope: 1, clip: 2 };
  unique.sort((a, b) => {
    const kind = rank[a.kind] - rank[b.kind];
    if (kind) return kind;
    const sev = a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1;
    if (sev) return sev;
    return String(a.workDate || '').localeCompare(String(b.workDate || ''));
  });
  return unique;
}

export function disputesForProof(moments: DisputeMoment[], proofId: string): DisputeMoment[] {
  return moments.filter((m) => m.proofId === proofId || m.relatedProofIds.includes(proofId));
}
