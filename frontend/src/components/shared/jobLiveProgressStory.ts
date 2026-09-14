/**
 * Homeowner live progress story — plain-English timeline from clip Glance/Scan.
 * Privacy-redacted moments are omitted, never quoted.
 */

import type { ProofConversation, ProofPeoplePresent, ProofVideoRecord } from '../../lib/api';
import { scrubHomeownerText } from '../../lib/privacyText';
import { formatWorkDay } from './jobProgressStory';

export type LiveStoryMoment = {
  id: string;
  workDate: string;
  whenLabel: string;
  phase: string | null;
  company: string;
  /** Glance — one plain sentence. */
  glance: string | null;
  /** Scan — calm bullets (who / decisions / next). */
  scan: string[];
  people: string[];
  privacyProtected: boolean;
};

export type HomeownerLiveProgressStory = {
  /** One or two plain sentences across clips. */
  overview: string;
  moments: LiveStoryMoment[];
  clipCount: number;
  withGlanceCount: number;
};

type VideoLike = Pick<
  ProofVideoRecord,
  | 'id'
  | 'workDate'
  | 'phase'
  | 'company'
  | 'aiSummary'
  | 'conversation'
  | 'people'
  | 'privacyRedactions'
  | 'receivedAt'
  | 'capturedAt'
>;

function pushUnique(points: string[], text: string | null | undefined): void {
  const t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return;
  const key = t.toLowerCase();
  if (points.some((p) => p.toLowerCase() === key)) return;
  points.push(t);
}

function factTexts(
  facts: Array<{ text?: string; owner?: string | null }> | string[] | null | undefined,
): string[] {
  if (!facts?.length) return [];
  const out: string[] = [];
  for (const item of facts) {
    if (typeof item === 'string') {
      pushUnique(out, item);
      continue;
    }
    const text = String(item.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const owner = item.owner ? ` (${item.owner})` : '';
    pushUnique(out, `${text}${owner}`);
  }
  return out;
}

function glanceFromConversation(c: ProofConversation | null | undefined): string | null {
  if (!c) return null;
  return scrubHomeownerText(c.conversationExecutiveSummary || c.conversationSummary);
}

function scanFromConversation(
  c: ProofConversation | null | undefined,
  privacyProtected: boolean,
): string[] {
  if (!c) return [];
  const points: string[] = [];
  const add = (raw: string | null | undefined) => {
    const scrubbed = scrubHomeownerText(raw, { privacyProtected });
    pushUnique(points, scrubbed);
  };

  for (const m of (c.conversationKeyMoments ?? []).slice(0, 4)) add(m.text);
  for (const t of factTexts(c.conversationAgreementFacts ?? c.conversationAgreements).slice(0, 2)) {
    add(t);
  }
  for (const t of factTexts(c.conversationRefusals).slice(0, 2)) add(t);
  for (const t of factTexts(c.conversationActionItems).slice(0, 2)) add(t);
  for (const t of factTexts(c.conversationCommitments).slice(0, 2)) add(t);
  for (const room of (c.conversationRooms ?? []).slice(0, 3)) {
    add(room ? `Area: ${room}` : null);
  }
  return points.slice(0, 6);
}

function peopleLabels(
  people: ProofPeoplePresent | null | undefined,
  privacyProtected: boolean,
): string[] {
  const list = people?.peoplePresent ?? [];
  const out: string[] = [];
  for (const person of list.slice(0, 8)) {
    const label =
      person.displayName ||
      person.label ||
      person.serviceTitle ||
      (person.role && person.role !== 'unknown' ? person.role : null);
    const scrubbed = scrubHomeownerText(label, { privacyProtected });
    pushUnique(out, scrubbed);
  }
  return out;
}

function phaseLabel(phase: string | null | undefined): string | null {
  const p = String(phase || '')
    .trim()
    .toLowerCase();
  if (!p) return null;
  if (p === 'before') return 'Morning / start';
  if (p === 'after') return 'End of day';
  return phase!.trim();
}

function sortKey(v: VideoLike): string {
  const received = v.receivedAt || v.capturedAt || '';
  return `${v.workDate}|${received}|${v.id}`;
}

/**
 * Build a chronological plain-English story from filed clips.
 * Uses Analysis Glance/Scan when present; never exposes private moments.
 */
export function buildHomeownerLiveProgressStory(videos: VideoLike[] | null | undefined): HomeownerLiveProgressStory {
  const list = [...(videos ?? [])].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const moments: LiveStoryMoment[] = [];

  for (const video of list) {
    const privacyProtected = Boolean(video.privacyRedactions?.ranges?.length);
    const glance =
      glanceFromConversation(video.conversation) ||
      scrubHomeownerText(video.aiSummary, { privacyProtected });
    const scan = scanFromConversation(video.conversation, privacyProtected);
    const people = peopleLabels(video.people, privacyProtected);

    // Skip clips with nothing homeowner-safe to say (silent + no summary, or fully private).
    if (!glance && scan.length === 0 && people.length === 0) {
      if (privacyProtected) {
        moments.push({
          id: video.id,
          workDate: video.workDate,
          whenLabel: `${formatWorkDay(video.workDate)} · ${video.company}`,
          phase: phaseLabel(video.phase),
          company: video.company,
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
      workDate: video.workDate,
      whenLabel: `${formatWorkDay(video.workDate)} · ${video.company}`,
      phase: phaseLabel(video.phase),
      company: video.company,
      glance,
      scan: scan.filter((p) => p !== glance),
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

export function liveStoryHasContent(story: HomeownerLiveProgressStory): boolean {
  return story.moments.some(
    (m) => Boolean(m.glance) || m.scan.length > 0 || m.people.length > 0 || m.privacyProtected,
  );
}
