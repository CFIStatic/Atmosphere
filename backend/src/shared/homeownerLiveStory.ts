/**
 * Homeowner live progress story — Glance/Scan timeline across filed clips.
 * Privacy-redacted moments are omitted, never quoted.
 */

import {
  isPrivateMomentText,
  privacyRedactionsFromStored,
  PRIVACY_REDACTED_LABEL,
} from '../audio/privacyRedactions.js';
import {
  CHILD_PRIVACY_REDACTED_LABEL,
  childPrivacyRedactionsFromStored,
  isChildPresenceText,
} from '../audio/childPrivacyRedactions.js';

export type LiveStoryMoment = {
  id: string;
  workDate: string;
  whenLabel: string;
  phase: string | null;
  company: string;
  glance: string | null;
  scan: string[];
  people: string[];
  privacyProtected: boolean;
};

export type HomeownerLiveProgressStory = {
  overview: string;
  moments: LiveStoryMoment[];
  clipCount: number;
  withGlanceCount: number;
};

type VideoLike = {
  id: string;
  workDate?: string | null;
  phase?: string | null;
  company?: string | null;
  aiSummary?: string | null;
  receivedAt?: string | null;
  capturedAt?: string | null;
  conversation?: Record<string, unknown> | null;
  people?: { peoplePresent?: Array<Record<string, unknown>> } | null;
  privacyRedactions?: { ranges?: unknown[] } | null;
};

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function scrubText(text: string | null | undefined, privacyProtected: boolean): string | null {
  const t = asString(text);
  if (!t || t === PRIVACY_REDACTED_LABEL) return null;
  if (privacyProtected && isPrivateMomentText(t)) return null;
  if (privacyProtected && isChildPresenceText(t)) return CHILD_PRIVACY_REDACTED_LABEL;
  if (isPrivateMomentText(t)) return null;
  return t.replace(/\s+/g, ' ').trim().slice(0, 400);
}

function pushUnique(points: string[], text: string | null | undefined): void {
  const t = asString(text);
  if (!t) return;
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

function formatWorkDay(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || 'Day';
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function phaseLabel(phase: string | null | undefined): string | null {
  const p = asString(phase).toLowerCase();
  if (!p) return null;
  if (p === 'before') return 'Morning / start';
  if (p === 'after') return 'End of day';
  return asString(phase);
}

function conversationFields(conversation: Record<string, unknown> | null | undefined) {
  if (!conversation) return null;
  // Accept both API camelCase (conversationExecutiveSummary) and stored (executiveSummary).
  return {
    headline:
      asString(conversation.conversationExecutiveSummary) ||
      asString(conversation.executiveSummary) ||
      asString(conversation.conversationSummary) ||
      asString(conversation.summary),
    keyMoments: conversation.conversationKeyMoments ?? conversation.keyMoments,
    agreements: conversation.conversationAgreementFacts ?? conversation.agreementFacts ?? conversation.conversationAgreements ?? conversation.agreements,
    refusals: conversation.conversationRefusals ?? conversation.refusals,
    actionItems: conversation.conversationActionItems ?? conversation.actionItems,
    commitments: conversation.conversationCommitments ?? conversation.commitments,
    rooms: conversation.conversationRooms ?? conversation.rooms,
  };
}

function peopleLabels(
  people: VideoLike['people'],
  privacyProtected: boolean,
): string[] {
  const list = people?.peoplePresent ?? [];
  const out: string[] = [];
  for (const person of list.slice(0, 8)) {
    const label =
      asString(person.displayName) ||
      asString(person.label) ||
      asString(person.serviceTitle) ||
      (asString(person.role) && asString(person.role) !== 'unknown' ? asString(person.role) : '');
    pushUnique(out, scrubText(label, privacyProtected));
  }
  return out;
}

function sortKey(v: VideoLike): string {
  return `${asString(v.workDate)}|${asString(v.receivedAt) || asString(v.capturedAt)}|${v.id}`;
}

/**
 * Compose a chronological plain-English live story from proof videos.
 */
export function composeHomeownerLiveStory(
  videos: VideoLike[] | null | undefined,
): HomeownerLiveProgressStory {
  const list = [...(videos ?? [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const moments: LiveStoryMoment[] = [];

  for (const video of list) {
    const ranges = privacyRedactionsFromStored(video.privacyRedactions);
    const childRanges = childPrivacyRedactionsFromStored(
      (video as { childPrivacyRedactions?: unknown }).childPrivacyRedactions,
    );
    const privacyProtected = ranges.length > 0 || childRanges.length > 0;
    const c = conversationFields(
      video.conversation && typeof video.conversation === 'object'
        ? video.conversation
        : null,
    );
    const glance =
      scrubText(c?.headline ?? null, privacyProtected) ||
      scrubText(video.aiSummary, privacyProtected);

    const scan: string[] = [];
    if (c) {
      for (const t of factTexts(c.keyMoments).slice(0, 4)) {
        pushUnique(scan, scrubText(t, privacyProtected));
      }
      for (const t of factTexts(c.agreements).slice(0, 2)) {
        pushUnique(scan, scrubText(t, privacyProtected));
      }
      for (const t of factTexts(c.refusals).slice(0, 2)) {
        pushUnique(scan, scrubText(t, privacyProtected));
      }
      for (const t of factTexts(c.actionItems).slice(0, 2)) {
        pushUnique(scan, scrubText(t, privacyProtected));
      }
      for (const t of factTexts(c.commitments).slice(0, 2)) {
        pushUnique(scan, scrubText(t, privacyProtected));
      }
      if (Array.isArray(c.rooms)) {
        for (const room of c.rooms.slice(0, 3)) {
          const label = asString(room);
          if (label) pushUnique(scan, scrubText(`Area: ${label}`, privacyProtected));
        }
      }
    }

    const people = peopleLabels(video.people, privacyProtected);
    const workDate = asString(video.workDate) || 'unknown';
    const company = asString(video.company) || 'Crew';

    if (!glance && scan.length === 0 && people.length === 0) {
      if (privacyProtected) {
        moments.push({
          id: video.id,
          workDate,
          whenLabel: `${formatWorkDay(workDate)} · ${company}`,
          phase: phaseLabel(video.phase),
          company,
          glance: null,
          scan: [],
          people: [],
          privacyProtected: true,
        });
      }
      continue;
    }

    moments.push({
      id: video.id,
      workDate,
      whenLabel: `${formatWorkDay(workDate)} · ${company}`,
      phase: phaseLabel(video.phase),
      company,
      glance,
      scan: scan.filter((p) => p !== glance).slice(0, 6),
      people,
      privacyProtected,
    });
  }

  const withGlance = moments.filter((m) => Boolean(m.glance));
  const headlines = withGlance.map((m) => m.glance!).slice(0, 3);
  let overview: string;
  if (headlines.length === 0) {
    overview =
      list.length === 0
        ? 'No field clips yet — the story fills in as crews film.'
        : list.length === 1
          ? 'One clip is on file; a plain-English Glance is still coming.'
          : `${list.length} clips are on file; Glance briefs will appear as analysis finishes.`;
  } else if (headlines.length === 1) {
    overview = headlines[0];
  } else {
    overview = headlines.join(' · ');
  }

  return {
    overview: overview.slice(0, 900),
    moments,
    clipCount: list.length,
    withGlanceCount: withGlance.length,
  };
}
