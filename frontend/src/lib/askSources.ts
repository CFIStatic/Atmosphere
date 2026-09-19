/**
 * Ask source citations — parse structured trailers (and legacy Source prose)
 * into short chip labels that navigate the job file, plus optional web links.
 */

export type AskSourceId =
  | 'job'
  | 'claim'
  | 'policy'
  | 'brief'
  | 'brief_note'
  | 'scope'
  | 'notes'
  | 'invited'
  | 'access'
  | 'task'
  | 'crew'
  | 'log'
  | 'memory'
  | 'document'
  | 'videos'
  | 'evidence'
  | `clip:${string}`;

export type AskSourceChip = {
  id: AskSourceId;
  label: string;
  /** Job-file section to open/scroll, when not a clip seek. */
  section?:
    | 'access'
    | 'scope'
    | 'videos'
    | 'evidence'
    | 'parties'
    | 'setup'
    | 'brief';
  workDate?: string;
};

/** Public-web citation chip — opens in a new tab. */
export type AskWebCitation = {
  title: string;
  url: string;
};

/** In-product Ask action chip (tool that already ran). */
export type AskActionChip = {
  tool: string;
  label: string;
  section?: string;
  path?: string;
};

const SOURCE_TRAILER_RE = /(?:\n|^)\s*⟦sources:\s*([^⟧]+)⟧\s*/i;
const WEB_TRAILER_RE = /(?:\n|^)\s*⟦web:\s*([^⟧]+)⟧\s*/i;
const ACTIONS_TRAILER_RE = /(?:\n|^)\s*⟦actions:\s*([^⟧]+)⟧\s*/i;
const LEGACY_SOURCE_RE = /\(\s*Sources?:\s*([^)]+)\)\.?/gi;

const KNOWN = new Set<string>([
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
]);

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function isClipId(raw: string): raw is `clip:${string}` {
  return /^clip:\d{4}-\d{2}-\d{2}$/i.test(raw);
}

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
  if (KNOWN.has(lower)) return lower as AskSourceId;
  return null;
}

function pushUnique(ids: AskSourceId[], next: AskSourceId | null) {
  if (!next) return;
  if (!ids.includes(next)) ids.push(next);
}

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

function parseTrailerIds(raw: string): AskSourceId[] {
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
      mapAskSourceFragment(token.replace(/_/g, ' ')) ??
      (KNOWN.has(token) ? (token as AskSourceId) : null);
    pushUnique(ids, mapped);
  }
  return ids;
}

function clipLabel(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return `${isoDate} clip`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[Number(m[2]) - 1] ?? m[2];
  const day = String(Number(m[3]));
  return `${month} ${day} clip`;
}

export function askSourceLabel(id: AskSourceId): string {
  if (id.startsWith('clip:')) return clipLabel(id.slice(5));
  switch (id) {
    case 'access':
      return 'Who has access';
    case 'invited':
      return 'Who is on this job';
    case 'brief_note':
      return 'Brief note';
    case 'brief':
      return 'Brief';
    case 'scope':
      return 'Scope';
    case 'videos':
      return 'Videos';
    case 'evidence':
      return 'Evidence';
    case 'notes':
      return 'Notes';
    case 'task':
      return 'Tasks';
    case 'crew':
      return 'Crew';
    case 'log':
      return 'Work logs';
    case 'memory':
      return 'Recent record';
    case 'document':
      return 'Documents';
    case 'claim':
      return 'Claim';
    case 'policy':
      return 'Policy';
    case 'job':
      return 'Job setup';
    default:
      return id;
  }
}

export function askSourceChip(id: AskSourceId): AskSourceChip {
  const label = askSourceLabel(id);
  if (id.startsWith('clip:')) {
    return { id, label, section: 'videos', workDate: id.slice(5) };
  }
  switch (id) {
    case 'access':
      return { id, label, section: 'access' };
    case 'invited':
    case 'crew':
      return { id, label, section: 'parties' };
    case 'scope':
    case 'task':
    case 'document':
    case 'job':
      return { id, label, section: id === 'scope' ? 'scope' : 'setup' };
    case 'brief':
    case 'brief_note':
    case 'notes':
    case 'claim':
    case 'policy':
    case 'log':
    case 'memory':
      return { id, label, section: 'setup' };
    case 'videos':
      return { id, label, section: 'videos' };
    case 'evidence':
      return { id, label, section: 'evidence' };
    default:
      return { id, label, section: 'setup' };
  }
}

export function parseAskWebTrailer(raw: string): AskWebCitation[] {
  const match = trim(raw).match(WEB_TRAILER_RE);
  if (!match) return [];
  const out: AskWebCitation[] = [];
  const blob = match[1] ?? '';
  const pairRe = /([^|,][^|]*?)\|(https?:\/\/[^,\s⟧]+)/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(blob)) !== null) {
    const title = trim(m[1]);
    const url = trim(m[2]);
    if (!title || !url) continue;
    if (out.some((c) => c.url === url)) continue;
    out.push({ title: title.slice(0, 120), url: url.slice(0, 500) });
  }
  return out;
}


export function parseAskActionsTrailer(raw: string): AskActionChip[] {
  const match = trim(raw).match(ACTIONS_TRAILER_RE);
  if (!match) return [];
  const out: AskActionChip[] = [];
  for (const part of (match[1] ?? '').split(/\s*;;\s*/)) {
    const [tool, label, section, path] = part.split('|');
    if (!trim(tool) || !trim(label)) continue;
    out.push({
      tool: trim(tool),
      label: trim(label).slice(0, 120),
      section: trim(section) || undefined,
      path: trim(path) || undefined,
    });
  }
  return out;
}

/**
 * Pull structured / legacy sources and optional web citations out of an Ask
 * answer for chip rendering. Body text no longer contains "(Source: …)" or
 * the machine trailers.
 */
export function extractAskSources(answer: string): {
  body: string;
  sources: AskSourceChip[];
  webSources: AskWebCitation[];
  actions: AskActionChip[];
} {
  let text = String(answer ?? '');
  const ids: AskSourceId[] = [];
  const webSources = parseAskWebTrailer(text);
  const actions = parseAskActionsTrailer(text);

  for (const id of parseTrailerIds(text)) pushUnique(ids, id);
  text = text.replace(SOURCE_TRAILER_RE, '').trimEnd();
  text = text.replace(WEB_TRAILER_RE, '').trimEnd();
  text = text.replace(ACTIONS_TRAILER_RE, '').trimEnd();

  text = text.replace(LEGACY_SOURCE_RE, (_full, blob: string) => {
    for (const id of parseLegacySourceBlob(blob)) pushUnique(ids, id);
    return '';
  });

  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return { body: text, sources: ids.map(askSourceChip), webSources, actions };
}
