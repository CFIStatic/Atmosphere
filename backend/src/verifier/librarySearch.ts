/**
 * All videos search, server side. Mirrors the `library-search` block in
 * verifier/index.html line for line so a search past the loaded page finds
 * exactly what the list would have found had it loaded everything.
 *
 * A clip or job file matches when ANY of these hold:
 * - text: every word typed appears (partial, case- and accent-blind,
 *   punctuation ignored) in the job name, number, company, person, address,
 *   claim, clip title, AI title, file name, phase or labels;
 * - id: the typed id / hash is the start of the clip id, recording (clip) id,
 *   job id or file hash, dashes ignored (3+ characters);
 * - date: the whole query reads as a day ("10/12", "Oct 12",
 *   "October 12, 2026", "2026-10-12", "12 Oct") or a month ("Oct 2026") and
 *   the clip was filmed / filed / uploaded that day in the viewer's timezone.
 */

const SEARCH_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

export type SearchDay = { y: number | null; m: number; d: number | null };
export type SearchDoc = {
  text: Array<string | number | null | undefined>;
  ids: Array<string | null | undefined>;
  dates: Array<string | null | undefined>;
};

export function searchNorm(s: unknown): string {
  let t = String(s ?? '').toLowerCase();
  t = t.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return t.replace(/&/g, ' & ').replace(/[^a-z0-9&#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function searchCompact(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function searchMonth(word: string | undefined): number {
  const w = String(word ?? '').toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return 0;
  const i = SEARCH_MONTHS.findIndex((m) => m.startsWith(w));
  if (i >= 0) return i + 1;
  return w === 'sept' ? 9 : 0;
}

function searchYear(y: string | undefined): number | null {
  if (y == null || y === '') return null;
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

/** The day (or month) a query names, when the whole query reads as a date. */
export function parseSearchDate(query: string | null | undefined): SearchDay | null {
  const q = String(query ?? '').trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!q) return null;
  let m: RegExpMatchArray | null;
  let out: SearchDay | null = null;
  if ((m = q.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    out = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  } else if ((m = q.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/))) {
    out = { y: searchYear(m[3]), m: Number(m[1]), d: Number(m[2]) };
  } else if ((m = q.match(/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/)) && searchMonth(m[1])) {
    out = { y: searchYear(m[3]), m: searchMonth(m[1]), d: Number(m[2]) };
  } else if ((m = q.match(/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/)) && searchMonth(m[2])) {
    out = { y: searchYear(m[3]), m: searchMonth(m[2]), d: Number(m[1]) };
  } else if ((m = q.match(/^([a-z]+)\.? (\d{4})$/)) && searchMonth(m[1])) {
    out = { y: Number(m[2]), m: searchMonth(m[1]), d: null };
  } else if ((m = q.match(/^(\d{4})[-/](\d{1,2})$/))) {
    out = { y: Number(m[1]), m: Number(m[2]), d: null };
  }
  if (!out || out.m < 1 || out.m > 12 || (out.d != null && (out.d < 1 || out.d > 31))) return null;
  return out;
}

function validTimeZone(tz: string | null | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

/** Calendar day of a stored value: a bare YYYY-MM-DD is that day; an instant is read in `timeZone`. */
export function searchLocalDay(value: string | null | undefined, timeZone?: string): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const raw = String(value).trim();
  const bare = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (bare) return { y: Number(bare[1]), m: Number(bare[2]), d: Number(bare[3]) };
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validTimeZone(timeZone) ?? 'UTC',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(dt);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function searchDateHit(want: SearchDay | null, values: SearchDoc['dates'], timeZone?: string): boolean {
  if (!want) return false;
  return values.some((value) => {
    const day = searchLocalDay(value, timeZone);
    if (!day || want.m !== day.m) return false;
    if (want.d != null && want.d !== day.d) return false;
    if (want.y != null && want.y !== day.y) return false;
    return true;
  });
}

function searchTextHit(query: string, fields: SearchDoc['text'], phraseOnly: boolean): boolean {
  const needle = searchNorm(query);
  if (!needle) return false;
  const hay = ` ${fields.map(searchNorm).filter(Boolean).join(' | ')} `;
  if (hay.includes(needle)) return true;
  if (phraseOnly) return false;
  return needle.split(' ').every((token) => hay.includes(token));
}

function searchIdHit(query: string, ids: SearchDoc['ids']): boolean {
  const raw = query.trim();
  if (/\s/.test(raw)) return false;
  const want = searchCompact(raw.replace(/^#/, ''));
  if (want.length < 3) return false;
  return ids.some((id) => {
    const c = searchCompact(id);
    return Boolean(c) && c.startsWith(want);
  });
}

export function searchHit(query: string | null | undefined, doc: SearchDoc, timeZone?: string): boolean {
  const q = String(query ?? '').trim();
  if (!q) return true;
  const day = parseSearchDate(q);
  if (searchTextHit(q, doc.text, Boolean(day))) return true;
  if (!day && searchIdHit(q, doc.ids)) return true;
  return searchDateHit(day, doc.dates, timeZone);
}

export type SearchJob = {
  jobId: string;
  jobName?: string | null;
  jobNumber?: number | string | null;
  address?: string | null;
  claimNumber?: string | null;
  company?: string | null;
  person?: string | null;
  createdAt?: string | null;
};

export type SearchClip = {
  id: string;
  jobId?: string | null;
  jobName?: string | null;
  address?: string | null;
  claimNumber?: string | null;
  company?: string | null;
  person?: string | null;
  title?: string | null;
  customTitle?: string | null;
  aiTitle?: string | null;
  fileName?: string | null;
  phase?: string | null;
  labels?: string[] | null;
  clipId?: string | null;
  hash?: string | null;
  workDate?: string | null;
  capturedAt?: string | null;
  uploadedAt?: string | null;
};

function jobText(job: SearchJob | undefined): SearchDoc['text'] {
  if (!job) return [];
  return [
    job.jobName,
    job.jobNumber != null && job.jobNumber !== '' ? `#${job.jobNumber}` : null,
    job.address,
    job.claimNumber,
    job.company,
    job.person,
  ];
}

export function clipSearchDoc(clip: SearchClip, job?: SearchJob): SearchDoc {
  return {
    text: [
      clip.jobName, clip.address, clip.claimNumber, clip.company, clip.person, clip.title,
      clip.customTitle, clip.aiTitle, clip.fileName, clip.phase,
      ...(Array.isArray(clip.labels) ? clip.labels : []),
      ...jobText(job),
    ],
    ids: [clip.id, clip.clipId, clip.hash, clip.jobId],
    dates: [clip.workDate, clip.capturedAt, clip.uploadedAt],
  };
}

export function jobSearchDoc(job: SearchJob): SearchDoc {
  return { text: jobText(job), ids: [job.jobId], dates: [job.createdAt] };
}

export function clipMatchesSearch(q: string | null | undefined, clip: SearchClip, job?: SearchJob, timeZone?: string): boolean {
  return searchHit(q, clipSearchDoc(clip, job), timeZone);
}

export function jobMatchesSearch(q: string | null | undefined, job: SearchJob, timeZone?: string): boolean {
  return searchHit(q, jobSearchDoc(job), timeZone);
}

/** The file name a crew would recognise: the last segment of the stored object path. */
export function fileNameOfStoragePath(path: string | null | undefined): string | null {
  const raw = String(path ?? '').trim();
  if (!raw) return null;
  const last = raw.split('/').filter(Boolean).pop();
  return last || null;
}
