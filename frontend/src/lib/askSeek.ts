import type { ProofQuestion, ProofResponse, ProofVideoRecord } from './api';

/** One Analysis event-boundary on a filed clip. */
export interface ClipSeekEvent {
  proofId: string;
  workDate: string;
  phase: string;
  atSeconds: number;
  text?: string;
}

export interface AskSeekTarget {
  atSeconds: number;
  proofId?: string;
  workDate?: string;
  phase?: string;
}

export interface AskCitePart {
  kind: 'text' | 'cite';
  text: string;
  atSeconds?: number;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
};

export function parseClockSeconds(stamp: string): number | null {
  const parts = stamp.split(':').map((part) => Number(part));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return null;
}

function wordNumber(raw: string): number | null {
  const token = raw.trim().toLowerCase();
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

function pushUnique(seconds: number[], next: number) {
  if (!Number.isFinite(next) || next < 0) return;
  const rounded = Math.round(next);
  if (!seconds.includes(rounded)) seconds.push(rounded);
}

/**
 * Seconds mentioned in an Ask answer — clocks ("0:18") and spoken times
 * ("18 seconds into the recording", "twelve seconds into the after clip").
 */
export function parseAnswerSeconds(answer: string): number[] {
  const text = String(answer ?? '');
  const found: number[] = [];
  const covered: Array<{ start: number; end: number }> = [];

  const take = (match: RegExpMatchArray, seconds: number | null) => {
    if (match.index == null || seconds == null) return;
    const start = match.index;
    const end = start + match[0].length;
    if (covered.some((span) => start < span.end && end > span.start)) return;
    covered.push({ start, end });
    pushUnique(found, seconds);
  };

  for (const match of text.matchAll(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g)) {
    take(match, parseClockSeconds(match[1]!));
  }

  for (const match of text.matchAll(
    /(\d+)\s+hours?\s+and\s+(\d+)\s+minutes?(?:\s+and\s+(\d+)\s+seconds?)?\s+into\s+the\s+recording/gi,
  )) {
    take(match, Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0));
  }

  for (const match of text.matchAll(
    /(\d+)\s+minutes?(?:\s+and\s+(\d+)\s+seconds?)?\s+into\s+the\s+recording/gi,
  )) {
    take(match, Number(match[1]) * 60 + Number(match[2] ?? 0));
  }

  for (const match of text.matchAll(
    /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\s+seconds?\s+into\s+(?:the\s+)?(?:recording|after clip|before clip|clip|video|footage)/gi,
  )) {
    take(match, wordNumber(match[1]!));
  }

  return found;
}

export function snapToEventBoundary(
  seconds: number,
  events: Array<number | Pick<ClipSeekEvent, 'atSeconds'>>,
): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  const stamps = events
    .map((event) => (typeof event === 'number' ? event : event.atSeconds))
    .filter((at) => Number.isFinite(at) && at >= 0);
  if (!stamps.length) return Math.round(seconds);
  let best = stamps[0]!;
  let dist = Math.abs(best - seconds);
  for (const at of stamps) {
    const next = Math.abs(at - seconds);
    if (next < dist || (next === dist && at > best)) {
      best = at;
      dist = next;
    }
  }
  return best;
}

function eventsFromUnknown(
  raw: unknown,
  proofId: string,
  workDate: string,
  phase: string,
): ClipSeekEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: ClipSeekEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const at = Number(
      rec.atSeconds ?? rec.at_seconds ?? rec.t_seconds ?? rec.startSeconds ?? rec.at,
    );
    if (!Number.isFinite(at) || at < 0) continue;
    const text = String(rec.text ?? rec.description ?? rec.summary ?? rec.note ?? '').trim();
    out.push({
      proofId,
      workDate,
      phase,
      atSeconds: at,
      text: text || undefined,
    });
  }
  return out;
}

function findingsEvents(
  findings: unknown,
  proofId: string,
  workDate: string,
  phase: string,
): ClipSeekEvent[] {
  if (!findings || typeof findings !== 'object') return [];
  const rec = findings as Record<string, unknown>;
  return [
    ...eventsFromUnknown(rec.events, proofId, workDate, phase),
    ...eventsFromUnknown(rec.timeline, proofId, workDate, phase),
    ...eventsFromUnknown(rec.actions, proofId, workDate, phase),
  ];
}

/** Event-boundary timestamps already produced by Analysis for the clips on file. */
export function analysisEventsFromProofs(
  proofs: ProofResponse | null | undefined,
): ClipSeekEvent[] {
  const out: ClipSeekEvent[] = [];
  const seen = new Set<string>();
  const push = (event: ClipSeekEvent) => {
    const key = `${event.proofId}|${event.atSeconds}|${event.text ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(event);
  };

  for (const video of proofs?.videos ?? []) {
    for (const event of video.events ?? []) {
      push({
        proofId: video.id,
        workDate: video.workDate,
        phase: video.phase,
        atSeconds: event.atSeconds,
        text: event.text,
      });
    }
  }

  for (const day of proofs?.days ?? []) {
    const findings = day.aiFindings as Record<string, unknown> | null;
    const afterId = day.proofIds[day.proofIds.length - 1];
    const beforeId = day.proofIds[0];
    if (afterId) {
      for (const event of findingsEvents(findings, afterId, day.workDate, 'after')) push(event);
    }
    if (day.reports?.after?.entries && afterId) {
      for (const event of eventsFromUnknown(
        day.reports.after.entries,
        afterId,
        day.workDate,
        'after',
      )) {
        push(event);
      }
    }
    if (day.reports?.before?.entries && beforeId && beforeId !== afterId) {
      for (const event of eventsFromUnknown(
        day.reports.before.entries,
        beforeId,
        day.workDate,
        'before',
      )) {
        push(event);
      }
    }
  }

  return out.sort((a, b) => a.atSeconds - b.atSeconds || a.proofId.localeCompare(b.proofId));
}

export function eventsForGrounded(
  events: ClipSeekEvent[],
  groundedIds?: string[] | null,
  videos?: ProofVideoRecord[],
): ClipSeekEvent[] {
  if (!groundedIds?.length) return events;
  const matched = events.filter((event) =>
    groundedIds.some(
      (id) =>
        id === event.proofId ||
        id === `${event.workDate}:${event.phase}` ||
        id === `${event.workDate}:clip`,
    ),
  );
  if (matched.length) return matched;
  const fromVideos = (videos ?? []).filter((video) =>
    groundedIds.some(
      (id) =>
        id === video.id ||
        id === `${video.workDate}:${video.phase}` ||
        id === `${video.workDate}:clip`,
    ),
  );
  if (!fromVideos.length) return events;
  const scoped = events.filter((event) => fromVideos.some((video) => video.id === event.proofId));
  return scoped.length ? scoped : events;
}

function pickClip(
  events: ClipSeekEvent[],
  groundedIds?: string[] | null,
  videos?: ProofVideoRecord[],
): Pick<AskSeekTarget, 'proofId' | 'workDate' | 'phase'> | undefined {
  const scoped = eventsForGrounded(events, groundedIds, videos);
  const hit = scoped[0];
  if (hit) return { proofId: hit.proofId, workDate: hit.workDate, phase: hit.phase };
  const video = (videos ?? []).find((item) =>
    groundedIds?.some(
      (id) =>
        id === item.id || id === `${item.workDate}:${item.phase}` || id === `${item.workDate}:clip`,
    ),
  );
  if (video) return { proofId: video.id, workDate: video.workDate, phase: video.phase };
  return undefined;
}

/** Where the player should jump for this Ask answer. */
export function seekTargetFromAnswer(input: {
  answer: string;
  events?: ClipSeekEvent[];
  groundedIds?: string[] | null;
  videos?: ProofVideoRecord[];
}): AskSeekTarget | null {
  const events = input.events ?? [];
  const scoped = eventsForGrounded(events, input.groundedIds, input.videos);
  const parsed = parseAnswerSeconds(input.answer);

  if (parsed.length) {
    const atSeconds = snapToEventBoundary(parsed[0]!, scoped);
    const owner = scoped.find((event) => event.atSeconds === atSeconds);
    const clip = owner
      ? { proofId: owner.proofId, workDate: owner.workDate, phase: owner.phase }
      : pickClip(scoped, input.groundedIds, input.videos);
    return {
      atSeconds,
      ...clip,
    };
  }

  const hay = input.answer.toLowerCase();
  const mentioned = scoped.find((event) => {
    const text = event.text?.toLowerCase().trim();
    return Boolean(text && text.length >= 6 && hay.includes(text));
  });
  if (mentioned) {
    return {
      atSeconds: mentioned.atSeconds,
      proofId: mentioned.proofId,
      workDate: mentioned.workDate,
      phase: mentioned.phase,
    };
  }

  return null;
}

const CITE_PATTERNS: RegExp[] = [
  /\bAt\s+(\d{1,2}:\d{2}(?::\d{2})?)\b/gi,
  /\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g,
  /(\d+)\s+hours?\s+and\s+(\d+)\s+minutes?(?:\s+and\s+(\d+)\s+seconds?)?\s+into\s+the\s+recording/gi,
  /(\d+)\s+minutes?(?:\s+and\s+(\d+)\s+seconds?)?\s+into\s+the\s+recording/gi,
  /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty)\s+seconds?\s+into\s+(?:the\s+)?(?:recording|after clip|before clip|clip|video|footage)/gi,
];

function citeSeconds(match: RegExpMatchArray): number | null {
  const clock = match[0]?.match(/\d{1,2}:\d{2}(?::\d{2})?/);
  if (clock) return parseClockSeconds(clock[0]);
  if (/hour/i.test(match[0] ?? '')) {
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
  }
  if (/minute/i.test(match[0] ?? '')) {
    return Number(match[1]) * 60 + Number(match[2] ?? 0);
  }
  return wordNumber(match[1] ?? '');
}

/** Split an answer so every mentioned moment is a clickable cite. */
export function splitAnswerCites(
  answer: string,
  events: Array<number | Pick<ClipSeekEvent, 'atSeconds'>> = [],
): AskCitePart[] {
  const text = String(answer ?? '');
  if (!text) return [];

  const hits: Array<{ start: number; end: number; atSeconds: number }> = [];
  for (const pattern of CITE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index == null) continue;
      const seconds = citeSeconds(match);
      if (seconds == null) continue;
      const start = match.index;
      const end = start + match[0].length;
      if (hits.some((hit) => start < hit.end && end > hit.start)) continue;
      hits.push({ start, end, atSeconds: snapToEventBoundary(seconds, events) });
    }
  }

  hits.sort((a, b) => a.start - b.start);
  if (!hits.length) return [{ kind: 'text', text }];

  const parts: AskCitePart[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, hit.start) });
    }
    parts.push({
      kind: 'cite',
      text: text.slice(hit.start, hit.end),
      atSeconds: hit.atSeconds,
    });
    cursor = hit.end;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}

export function groundedIdsFromQuestion(question: ProofQuestion | null | undefined): string[] {
  return question?.grounded_on ?? [];
}
