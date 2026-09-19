/**
 * Ask source citations — structured trailer the UI turns into chips/links.
 *
 * Models must not write "(Source: A / B / C)" prose. They append one machine
 * line the office Ask bubble strips and renders as short navigation chips.
 */

/** Stable ids the model may list after ⟦sources: …⟧ */
export const ASK_SOURCE_IDS = [
  'job',
  'claim',
  'policy',
  'brief',
  'brief_note',
  'scope',
  'notes',
  'invited',
  'access',
  'task',
  'crew',
  'log',
  'memory',
  'document',
  'videos',
  'evidence',
] as const;

export type AskSourceId = (typeof ASK_SOURCE_IDS)[number] | `clip:${string}`;

const SOURCE_TRAILER_RE = /(?:\n|^)\s*⟦sources:\s*([^⟧]+)⟧\s*/i;
const LEGACY_SOURCE_RE = /\(\s*Sources?:\s*([^)]+)\)\.?/gi;

/** Prompt block appended to Ask system prompts. */
export const ASK_SOURCE_FORMAT_RULES = `SOURCES (required for checkable answers — the UI turns these into chips):
- Never write parenthetical prose like "(Source: Field Capture / Brief note / Scope)" or "(Source: Videos and mic, …)".
- After the human answer, append exactly one machine line the UI strips:
  ⟦sources: scope, access, brief_note, clip:2026-09-12⟧
- Use only these ids (comma-separated): job, claim, policy, brief, brief_note, scope, notes, invited, access, task, crew, log, memory, document, videos, evidence, and clip:YYYY-MM-DD for a specific filmed day.
- Prefer one id per distinct place you used. Multiple clip days → multiple clip:DATE ids. Skip the line only when the file truly has nothing relevant.`;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function isClipId(raw: string): raw is `clip:${string}` {
  return /^clip:\d{4}-\d{2}-\d{2}$/i.test(raw);
}

function isKnownId(raw: string): raw is AskSourceId {
  if (isClipId(raw)) return true;
  return (ASK_SOURCE_IDS as readonly string[]).includes(raw);
}

/** Normalize a free-form fragment from legacy "(Source: …)" into a stable id. */
export function mapAskSourceFragment(raw: string): AskSourceId | null {
  const text = trim(raw).replace(/\s+/g, ' ');
  if (!text) return null;

  const clipDate = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (clipDate && /clip|video|mic|footage|film/i.test(text)) {
    return `clip:${clipDate[1]}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `clip:${text}`;

  const lower = text.toLowerCase();
  if (/^field\s*capture$/.test(lower) || /\bwho has access\b/.test(lower) || /^access$/.test(lower)) {
    return 'access';
  }
  if (
    /^invited(\s+section)?$/.test(lower) ||
    /\bwho is on this job\b/.test(lower) ||
    /^parties$/.test(lower)
  ) {
    return 'invited';
  }
  if (/brief\s*note/.test(lower)) return 'brief_note';
  if (/^brief(\s+facts?)?$/.test(lower)) return 'brief';
  if (/^scope(\s+(section|list|lines?))?$/.test(lower)) return 'scope';
  if (/videos?\s*(and\s*)?(mic|analysis)?/.test(lower) || /^mic$/.test(lower)) return 'videos';
  if (/^evidence(\s+(locker|row|log))?$/.test(lower)) return 'evidence';
  if (/^notes?(\s+and\s+messages)?$/.test(lower) || /^messages?$/.test(lower)) return 'notes';
  if (/^tasks?$/.test(lower)) return 'task';
  if (/^crew$/.test(lower)) return 'crew';
  if (/^(work\s*)?logs?$/.test(lower)) return 'log';
  if (/^memory$|^recent\s+record$/.test(lower)) return 'memory';
  if (/^documents?$|^uploaded/.test(lower)) return 'document';
  if (/^claim$/.test(lower)) return 'claim';
  if (/^policy$/.test(lower)) return 'policy';
  if (/^job(\s+(setup|identity|file))?$/.test(lower) || /^description$|^schedule$/.test(lower)) {
    return 'job';
  }
  if (isKnownId(lower as AskSourceId)) return lower as AskSourceId;
  return null;
}

function pushUnique(ids: AskSourceId[], next: AskSourceId | null) {
  if (!next) return;
  if (!ids.includes(next)) ids.push(next);
}

/** Split a legacy "(Source: A / B / C)" body into stable ids. */
export function parseLegacySourceBlob(blob: string): AskSourceId[] {
  const text = trim(blob);
  if (!text) return [];

  const ids: AskSourceId[] = [];
  for (const match of text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)) {
    pushUnique(ids, `clip:${match[1]}`);
  }

  const parts = text
    .split(/\s*(?:\/|,|;|\band\b)\s*/i)
    .map((part) =>
      part
        .replace(/\bclips?\b/gi, '')
        .replace(/\bsection\b/gi, '')
        .trim(),
    )
    .filter(Boolean);

  for (const part of parts) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(part)) continue;
    pushUnique(ids, mapAskSourceFragment(part));
  }

  if (!ids.length) pushUnique(ids, mapAskSourceFragment(text));
  return ids;
}

export function parseSourceTrailerIds(raw: string): AskSourceId[] {
  const match = trim(raw).match(SOURCE_TRAILER_RE);
  if (!match) return [];
  const ids: AskSourceId[] = [];
  for (const part of (match[1] ?? '').split(/[,|]+/)) {
    const token = trim(part).toLowerCase().replace(/\s+/g, '_');
    if (!token) continue;
    if (isClipId(token)) {
      pushUnique(ids, token.toLowerCase() as AskSourceId);
      continue;
    }
    const mapped =
      mapAskSourceFragment(token.replace(/_/g, ' ')) ?? (isKnownId(token) ? (token as AskSourceId) : null);
    pushUnique(ids, mapped);
  }
  return ids;
}

export function formatSourceTrailer(ids: AskSourceId[]): string {
  if (!ids.length) return '';
  return `⟦sources: ${ids.join(', ')}⟧`;
}

/**
 * Strip legacy "(Source: …)" blobs and normalize / attach a structured trailer.
 * Returns cleaned prose suitable to store and render.
 */
export function normalizeAskSources(input: string): string {
  let text = String(input ?? '');
  if (!text) return text;

  const collected: AskSourceId[] = [];
  for (const id of parseSourceTrailerIds(text)) pushUnique(collected, id);

  text = text.replace(SOURCE_TRAILER_RE, '').trimEnd();

  text = text.replace(LEGACY_SOURCE_RE, (_full, blob: string) => {
    for (const id of parseLegacySourceBlob(blob)) pushUnique(collected, id);
    return '';
  });

  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!collected.length) return text;
  return `${text}\n\n${formatSourceTrailer(collected)}`;
}
