/**
 * Build a Glance-style day timeline from filed clips.
 * Mirrors ConversationPanel glancePoints; scrubs privacy redactions.
 */

import {
  isPrivateMomentText,
  privacyRedactionsFromStored,
  PRIVACY_REDACTED_LABEL,
  redactTranscriptForAsk,
} from '../audio/privacyRedactions.js';
import {
  childPrivacyRedactionsFromStored,
} from '../audio/childPrivacyRedactions.js';
import type { DailyJobGlanceReport, GlanceClipSummary } from './types.js';

type ProofRow = {
  id: string;
  clip_id?: string | null;
  work_date?: string | null;
  phase?: string | null;
  received_at?: string | null;
  ai_summary?: string | null;
  ai_findings?: unknown;
  title?: string | null;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function scrubText(text: string | null | undefined, privacyProtected: boolean): string | null {
  const t = asString(text);
  if (!t) return null;
  if (privacyProtected && isPrivateMomentText(t)) return PRIVACY_REDACTED_LABEL;
  if (isPrivateMomentText(t)) return PRIVACY_REDACTED_LABEL;
  return t.replace(/\s+/g, ' ').trim().slice(0, 400);
}

function pushUnique(points: string[], text: string | null | undefined): void {
  const t = asString(text);
  if (!t || t === PRIVACY_REDACTED_LABEL) return;
  const key = t.toLowerCase();
  if (points.some((p) => p.toLowerCase() === key)) return;
  points.push(t);
}

function factTexts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      pushUnique(out, item);
      continue;
    }
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>;
      const text = asString(row.text) || asString(row.fact) || asString(row.label);
      const owner = asString(row.owner);
      pushUnique(out, owner ? `${text} (${owner})` : text);
    }
  }
  return out;
}

function glancePointsFromConversation(
  conversation: Record<string, unknown> | null,
  privacyProtected: boolean,
): { headline: string | null; points: string[] } {
  if (!conversation) return { headline: null, points: [] };
  const headline = scrubText(
    asString(conversation.executiveSummary) || asString(conversation.summary),
    privacyProtected,
  );
  const points: string[] = [];
  const addList = (raw: unknown, limit: number) => {
    for (const t of factTexts(raw).slice(0, limit)) {
      const scrubbed = scrubText(t, privacyProtected);
      pushUnique(points, scrubbed);
    }
  };
  addList(conversation.keyMoments, 4);
  addList(conversation.agreementFacts ?? conversation.agreements, 2);
  addList(conversation.refusals, 2);
  addList(conversation.actionItems, 2);
  addList(conversation.commitments, 2);
  return { headline, points: points.slice(0, 6) };
}

function peopleLabels(peoplePresent: unknown, privacyProtected: boolean): string[] {
  if (!peoplePresent || typeof peoplePresent !== 'object') return [];
  const list = (peoplePresent as { peoplePresent?: unknown }).peoplePresent;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const person of list.slice(0, 8)) {
    if (!person || typeof person !== 'object') continue;
    const row = person as Record<string, unknown>;
    const label =
      asString(row.displayName) ||
      asString(row.label) ||
      asString(row.name) ||
      asString(row.role);
    const scrubbed = scrubText(label, privacyProtected);
    pushUnique(out, scrubbed);
  }
  return out;
}

export function composeClipGlance(row: ProofRow): GlanceClipSummary {
  const findings =
    row.ai_findings && typeof row.ai_findings === 'object'
      ? (row.ai_findings as Record<string, unknown>)
      : {};
  const ranges = privacyRedactionsFromStored(findings.privacyRedactions);
  const childRanges = childPrivacyRedactionsFromStored(findings.childPrivacyRedactions);
  const privacyProtected = ranges.length > 0 || childRanges.length > 0;

  const conversation =
    findings.conversation && typeof findings.conversation === 'object'
      ? (findings.conversation as Record<string, unknown>)
      : null;

  const { headline, points } = glancePointsFromConversation(conversation, privacyProtected);

  let summaryFallback = scrubText(row.ai_summary, privacyProtected);
  if (privacyProtected && summaryFallback) {
    summaryFallback = redactTranscriptForAsk(summaryFallback, ranges) || summaryFallback;
    if (isPrivateMomentText(summaryFallback)) summaryFallback = PRIVACY_REDACTED_LABEL;
  }

  return {
    proofId: String(row.id),
    clipId: row.clip_id ? String(row.clip_id) : null,
    workDate: String(row.work_date ?? ''),
    phase: row.phase ? String(row.phase) : null,
    title: scrubText(row.title, privacyProtected),
    receivedAt: row.received_at ? String(row.received_at) : null,
    headline: headline || summaryFallback,
    points,
    people: peopleLabels(findings.peoplePresent ?? findings.people, privacyProtected),
    privacyProtected,
  };
}

export function composeDailyGlance(input: {
  orgId: string;
  jobId: string;
  jobTitle?: string | null;
  orgName?: string | null;
  localDay: string;
  timezone: string;
  proofs: ProofRow[];
}): DailyJobGlanceReport {
  const clips = input.proofs.map(composeClipGlance);
  const headlines = clips
    .map((c) => c.headline)
    .filter((h): h is string => Boolean(h && h !== PRIVACY_REDACTED_LABEL));
  const overview =
    headlines.length === 0
      ? clips.length
        ? `${clips.length} clip${clips.length === 1 ? '' : 's'} on file; no Glance brief yet.`
        : 'No clips filed this day.'
      : headlines.slice(0, 3).join(' · ');

  return {
    orgId: input.orgId,
    jobId: input.jobId,
    jobTitle: input.jobTitle ?? null,
    orgName: input.orgName ?? null,
    localDay: input.localDay,
    timezone: input.timezone,
    clips,
    overview: overview.slice(0, 900),
  };
}
