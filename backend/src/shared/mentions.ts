/**
 * @mentions for Ask.
 *
 * A mention is a person's name: the profile display name, or the name from
 * their login (OAuth full_name / name) when the profile name is empty.
 * There is no separate username. Client-supplied user ids are never trusted
 * unless that id is in the caller's org roster.
 */

export interface MentionIdentity {
  userId: string;
  email?: string | null;
  /** Profile display name. */
  fullName?: string | null;
  /** Auth user metadata name, used only when the profile name is empty. */
  loginName?: string | null;
  avatarUrl?: string | null;
}

export type MentionMember = MentionIdentity;

export interface ParsedMention {
  /** Text the author typed after @, or the label inside a stored token. */
  raw: string;
  /** Id the client claimed. Ignored unless that id is in the org roster. */
  claimedUserId: string | null;
  index: number;
}

export interface ResolvedMention {
  userId: string;
  /** Compact form of the display name, stored on the tag index. Not a username. */
  handle: string;
  name: string;
}

export interface AmbiguousMention {
  query: string;
  candidates: Array<{ userId: string; name: string }>;
}

export interface MentionResolution {
  mentions: ResolvedMention[];
  ambiguous: AmbiguousMention[];
}

const STRUCTURED_RE = /@\[([^\]\n]{1,80})\]\(mention:([A-Za-z0-9_-]{1,64})\)/g;
const BARE_MARK_RE = /(^|[\s(])@/g;

const TOPIC_STOP = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'to', 'and', 'or', 'did', 'does', 'do', 'is', 'was',
  'are', 'were', 'this', 'that', 'it', 'any', 'what', 'when', 'where', 'how', 'who', 'why',
  'he', 'she', 'they', 'him', 'her', 'his', 'their', 'finish', 'finished', 'finishing',
  'complete', 'completed', 'done', 'please', 'about', 'for', 'with', 'from', 'has', 'have',
  'had', 'been', 'being', 'me', 'tell', 'show',
]);

const RANK_STOP = new Set([...TOPIC_STOP, 'job', 'jobs', 'work', 'video', 'videos', 'clip', 'clips']);

/** Profile name, otherwise the login/OAuth name. Empty when neither is set. */
export function mentionDisplayName(input: {
  fullName?: string | null;
  loginName?: string | null;
}): string {
  const profile = String(input.fullName ?? '').replace(/\s+/g, ' ').trim();
  if (profile) return profile;
  return String(input.loginName ?? '').replace(/\s+/g, ' ').trim();
}

/** full_name wins over name. Both come from auth user metadata. */
export function loginNameFromMetadata(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const record = meta as Record<string, unknown>;
  for (const key of ['full_name', 'name']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.replace(/\s+/g, ' ').trim();
  }
  return null;
}

/** Spaces and punctuation removed, for `@johncyganiak` against "John Cyganiak". */
export function nameKey(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function mentionToken(name: string, userId: string): string {
  return `@[${name}](mention:${userId})`;
}

function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]+/g, ''))
    .filter(Boolean);
}

/** `@Jane's` is the name Jane, not a different token. */
function withoutPossessive(query: string): string {
  return query.replace(/['’]s$/i, '');
}

/**
 * Case-insensitive prefix of the full name or of any word in it.
 * `@jo` matches "John Cyganiak"; `@cyg` matches the last name; `@john c` matches the full name.
 */
export function nameMatchesQuery(name: string, query: string): boolean {
  const q = withoutPossessive(query.trim().toLowerCase());
  if (!q || !name.trim()) return false;
  const full = name.trim().toLowerCase();
  if (full.startsWith(q)) return true;
  const qWord = q.split(/\s+/)[0] ?? q;
  return nameWords(name).some((word) => word.startsWith(qWord) && (q === qWord || full.startsWith(q)));
}

function boundaryAfter(text: string, length: number): boolean {
  const next = text[length] ?? '';
  if (next === '' || /[\s,.;:!?)]/.test(next)) return true;
  // `@Jane's` and `@El Presidente's` end the name. An apostrophe inside the name does not.
  return /^['’]s(?=$|[\s,.;:!?])/i.test(text.slice(length));
}

function membersMatching(query: string, roster: MentionMember[]): MentionMember[] {
  const q = query.trim();
  if (!q) return [];
  const exact = roster.filter((member) => mentionDisplayName(member).toLowerCase() === q.toLowerCase());
  if (exact.length) return exact;
  const compact = nameKey(q);
  if (compact.length >= 2) {
    const compactHits = roster.filter((member) => nameKey(mentionDisplayName(member)) === compact);
    if (compactHits.length) return compactHits;
  }
  return roster.filter((member) => nameMatchesQuery(mentionDisplayName(member), q));
}

function toResolved(member: MentionMember): ResolvedMention {
  const name = mentionDisplayName(member);
  return { userId: member.userId, name, handle: nameKey(name).slice(0, 32) || 'name' };
}

export function parseMentions(text: string): ParsedMention[] {
  const source = String(text ?? '');
  const found: ParsedMention[] = [];
  const covered: Array<[number, number]> = [];
  for (const match of source.matchAll(new RegExp(STRUCTURED_RE.source, 'g'))) {
    const index = match.index ?? 0;
    found.push({
      raw: String(match[1] ?? '').trim(),
      claimedUserId: match[2] ?? null,
      index,
    });
    covered.push([index, index + match[0].length]);
  }
  for (const mark of source.matchAll(new RegExp(BARE_MARK_RE.source, 'g'))) {
    const lead = mark[1] ?? '';
    const index = (mark.index ?? 0) + lead.length;
    if (covered.some(([start, end]) => index >= start && index < end)) continue;
    const rest = source.slice(index + 1);
    const token = rest.match(/^[A-Za-z0-9][A-Za-z0-9'’.\-]{0,60}/);
    if (!token) continue;
    found.push({ raw: token[0], claimedUserId: null, index });
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}

/**
 * Resolve every mention against one org roster.
 * A claimed id outside the roster is ignored. A typed name that matches more
 * than one person is returned as ambiguous instead of guessing.
 */
export function resolveMentions(text: string, roster: MentionMember[]): MentionResolution {
  const source = String(text ?? '');
  const byId = new Map(roster.map((member) => [member.userId, member]));
  const mentions: ResolvedMention[] = [];
  const ambiguous: AmbiguousMention[] = [];
  const seen = new Set<string>();
  const covered: Array<[number, number]> = [];

  const pushMember = (member: MentionMember) => {
    if (seen.has(member.userId)) return;
    seen.add(member.userId);
    mentions.push(toResolved(member));
  };
  const pushAmbiguous = (query: string, matches: MentionMember[]) => {
    const key = query.trim().toLowerCase();
    if (ambiguous.some((row) => row.query.toLowerCase() === key)) return;
    ambiguous.push({
      query: query.trim(),
      candidates: matches
        .map((member) => ({ userId: member.userId, name: mentionDisplayName(member) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  };

  for (const match of source.matchAll(new RegExp(STRUCTURED_RE.source, 'g'))) {
    const index = match.index ?? 0;
    covered.push([index, index + match[0].length]);
    const label = String(match[1] ?? '').trim();
    const claimed = match[2] ? byId.get(match[2]) ?? null : null;
    if (claimed) {
      pushMember(claimed);
      continue;
    }
    const matches = membersMatching(label, roster);
    if (matches.length === 1) pushMember(matches[0]!);
    else if (matches.length > 1) pushAmbiguous(label, matches);
  }

  for (const mark of source.matchAll(new RegExp(BARE_MARK_RE.source, 'g'))) {
    const lead = mark[1] ?? '';
    const index = (mark.index ?? 0) + lead.length;
    if (covered.some(([start, end]) => index >= start && index < end)) continue;
    const rest = source.slice(index + 1);
    let best: { length: number; matches: MentionMember[] } | null = null;
    for (const member of roster) {
      const name = mentionDisplayName(member);
      if (name.length < 2) continue;
      if (!rest.toLowerCase().startsWith(name.toLowerCase())) continue;
      if (!boundaryAfter(rest, name.length)) continue;
      if (!best || name.length > best.length) {
        best = {
          length: name.length,
          matches: roster.filter(
            (row) => mentionDisplayName(row).toLowerCase() === name.toLowerCase(),
          ),
        };
      }
    }
    if (best) {
      if (best.matches.length === 1) pushMember(best.matches[0]!);
      else pushAmbiguous(mentionDisplayName(best.matches[0]!), best.matches);
      continue;
    }
    const token = rest.match(/^[A-Za-z0-9][A-Za-z0-9'’.\-]{0,60}/);
    if (!token) continue;
    const query = withoutPossessive(token[0]);
    if (!query) continue;
    const matches = membersMatching(query, roster);
    if (matches.length === 1) pushMember(matches[0]!);
    else if (matches.length > 1) pushAmbiguous(query, matches);
  }

  return { mentions, ambiguous };
}

/** Someone named in a job chat who is not assigned, a capturer, or tagged there. */
export function notOnJobSentence(name: string, otherJobs: string[]): string {
  const who = name.trim() || 'That person';
  const titles = otherJobs.map((job) => job.trim()).filter(Boolean);
  if (!titles.length) return `${who} isn't on this job.`;
  const list =
    titles.length === 1
      ? titles[0]
      : titles.length === 2
        ? `${titles[0]} and ${titles[1]}`
        : `${titles.slice(0, -1).join(', ')}, and ${titles[titles.length - 1]}`;
  return `${who} isn't on this job. They're on ${list}.`;
}

export function ambiguitySentence(query: string, candidates: Array<{ name: string }>): string {
  const names = candidates.map((row) => row.name).filter(Boolean);
  const list =
    names.length <= 1
      ? names.join('')
      : names.length === 2
        ? `${names[0]} or ${names[1]}`
        : `${names.slice(0, -1).join(', ')}, or ${names[names.length - 1]}`;
  const raw = query.trim();
  const shown = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'person';
  return `Which ${shown} did you mean? ${list}.`;
}

/**
 * Remove mention marks without cutting a multi-word name down to its first word.
 * Structured chips and resolved display names go first; a leftover single @word
 * is only the unmatched tail.
 */
export function stripMentionMarks(question: string, names: string[] = []): string {
  let text = String(question ?? '').replace(new RegExp(STRUCTURED_RE.source, 'g'), ' ');
  const ordered = [...names]
    .map((name) => name.trim())
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`(^|[\\s(])@${escaped}(?:['’]s)?(?=$|[\\s,.;:!?])`, 'gi'), '$1 ');
  }
  return text.replace(/(^|[\s(])@[A-Za-z0-9][A-Za-z0-9'’.\-]{0,80}/g, '$1 ');
}

const FOLLOW_UP_PRONOUN = /\b(they|them|their|theirs|he|him|his|she|her|hers)\b/i;

/**
 * A follow-up with no new name ("what all the videos they upload") keeps the
 * one person named in the earlier user turns. Two people, or an ambiguous
 * name, is not carried.
 */
export function carryPriorMention(
  question: string,
  history: Array<{ role?: string | null; text?: string | null }> | null | undefined,
  roster: MentionMember[],
): ResolvedMention | null {
  if (!FOLLOW_UP_PRONOUN.test(String(question ?? ''))) return null;
  const current = resolveMentions(question, roster);
  if (current.mentions.length || current.ambiguous.length) return null;
  for (const turn of [...(history ?? [])].reverse()) {
    if (String(turn.role ?? '') !== 'user') continue;
    const resolved = resolveMentions(String(turn.text ?? ''), roster);
    if (resolved.ambiguous.length) return null;
    if (resolved.mentions.length > 1) return null;
    if (resolved.mentions.length === 1) return resolved.mentions[0]!;
  }
  return null;
}

/** True when this person filmed, wrote, or opened something. A tag in someone else's clip does not count. */
export function personHasActivity(person: { items: Array<{ kind: string; captured?: boolean }> }): boolean {
  return person.items.some((item) => item.captured === true);
}

/** "did he finish the electrical job?" → "electrical job". */
export function topicFromQuestion(question: string, names: string[] = []): string {
  const stripped = stripMentionMarks(question, names);
  const words = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !TOPIC_STOP.has(word));
  return words.slice(0, 6).join(' ');
}

export function questionTokens(question: string, names: string[] = []): string[] {
  const stripped = stripMentionMarks(question, names);
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const word of stripped.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)) {
    if (word.length < 3 || RANK_STOP.has(word) || seen.has(word)) continue;
    seen.add(word);
    tokens.push(word);
  }
  return tokens;
}

export interface MentionItem {
  kind: 'job' | 'video' | 'note' | 'task' | 'log';
  id: string;
  jobId: string | null;
  title: string;
  text: string;
  at: string | null;
  status?: string | null;
  /** Personally captured / authored, rather than merely on an assigned job. */
  captured?: boolean;
  proofId?: string | null;
  workDate?: string | null;
  /** One short sentence plus at most one key detail. Omits raw mic quotes. */
  listLine?: string | null;
  /** The one finding or notable issue for this clip, when there is one. */
  finding?: string | null;
  durationSeconds?: number | null;
  /** Model-facing clip detail. Speech stays labeled and out of the rundown. */
  detail?: string | null;
  /** Timed mic text for the model. The grounded fallback does not print it. */
  transcript?: string | null;
  /** Speaker labels from the clip, when the file has them. */
  speakers?: string | null;
}

export interface RankedMentionItem extends MentionItem {
  score: number;
  relevant: boolean;
}

function recencyScore(at: string | null, now: number): number {
  if (!at) return 0.15;
  const ms = now - new Date(at).getTime();
  if (!Number.isFinite(ms)) return 0.15;
  const days = Math.max(0, ms / 86_400_000);
  return Math.exp(-days / 45);
}

function scoreMentionItems(
  items: MentionItem[],
  question: string,
  now: Date,
  names: string[],
): RankedMentionItem[] {
  const tokens = questionTokens(question, names);
  const nowMs = now.getTime();
  return items.map((item) => {
    const hay = `${item.title} ${item.text} ${item.status ?? ''}`.toLowerCase();
    const hits = tokens.filter((token) => hay.includes(token)).length;
    const relevance = tokens.length ? hits / tokens.length : 1;
    const relevant = tokens.length ? hits > 0 : true;
    const score = relevance * 0.72 + recencyScore(item.at, nowMs) * 0.28 + (item.captured ? 0.04 : 0);
    return { ...item, score, relevant };
  });
}

export function rankMentionItems(
  items: MentionItem[],
  question: string,
  now: Date = new Date(),
  names: string[] = [],
): RankedMentionItem[] {
  return scoreMentionItems(items, question, now, names)
    .filter((item) => item.relevant)
    .sort((a, b) => b.score - a.score || String(b.at ?? '').localeCompare(String(a.at ?? '')));
}

/** Every row stays. Keyword hits sort first; they do not drop the rest of the file. */
export function orderMentionItems(
  items: MentionItem[],
  question: string,
  now: Date = new Date(),
  names: string[] = [],
): RankedMentionItem[] {
  return scoreMentionItems(items, question, now, names).sort(
    (a, b) => Number(b.relevant) - Number(a.relevant) || b.score - a.score || String(b.at ?? '').localeCompare(String(a.at ?? '')),
  );
}

export function sourceSlug(label: string): string {
  const slug = String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'item';
}

export function jobSourceId(jobId: string, label: string): string {
  return `job/${jobId}/${sourceSlug(label)}`;
}

export function videoSourceId(jobId: string, proofId: string, label: string): string {
  return `video/${jobId}/${proofId}/${sourceSlug(label)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function prettyMentionDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!match) return '';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return '';
  return `${month} ${Number(match[3])}`;
}

const ZONE_ABBREV: Record<string, string> = {
  'America/Chicago': 'CT',
  'America/New_York': 'ET',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  'America/Phoenix': 'MST',
  'America/Anchorage': 'AKT',
  'Pacific/Honolulu': 'HT',
};

/** A usable IANA zone, or null. */
export function mentionTimeZone(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const zone = String(candidate ?? '').trim();
    if (!zone || zone.length > 64) continue;
    try {
      Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
      return zone;
    } catch {
      /* try the next one */
    }
  }
  return 'America/New_York';
}

/** Drop a trailing comma or period so titles read as names ("Inside a Home"). */
export function cleanMentionTitle(title: string): string {
  return String(title ?? '')
    .replace(/[\s,;:.!?…]+$/g, '')
    .trim();
}

/**
 * Local calendar stamp. A date-only value stays a date (no invented clock).
 * A timestamp is the org/user zone, e.g. "Sep 17, 10:11 AM CT", never UTC.
 */
export function prettyMentionStamp(
  value: string | null | undefined,
  timeZone?: string | null,
): { day: string; stamp: string } {
  const raw = String(value ?? '').trim();
  if (!raw) return { day: '', stamp: '' };
  const hasTime = /[T ]\d{2}:\d{2}/.test(raw);
  if (!hasTime) {
    const day = prettyMentionDate(raw);
    return { day, stamp: day };
  }
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    const day = prettyMentionDate(raw);
    return { day, stamp: day };
  }
  const zone = mentionTimeZone(timeZone);
  const when = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(when);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  const day = `${part('month')} ${Number(part('day')) || part('day')}`;
  const clock = `${part('hour')}:${part('minute')} ${part('dayPeriod').toUpperCase()}`;
  const abbr = ZONE_ABBREV[zone] ?? zoneAbbrev(zone, when);
  return { day, stamp: `${day}, ${clock} ${abbr}`.trim() };
}

function zoneAbbrev(timeZone: string, when: Date): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(when)
    .find((item) => item.type === 'timeZoneName')?.value;
  if (!name || /UTC|GMT/i.test(name)) return '';
  return name;
}

export function prettyDuration(seconds: number | null | undefined): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '';
  const rounded = Math.round(value);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function displayJobTitle(title: string): string {
  return title.replace(/^#\d+\s+/, '').trim();
}

function chrono(a: { at?: string | null; workDate?: string | null }, b: { at?: string | null; workDate?: string | null }): number {
  const left = a.at || a.workDate || '';
  const right = b.at || b.workDate || '';
  return left.localeCompare(right);
}

function activityZone(person: PersonMentionContext): string {
  return mentionTimeZone(person.timeZone);
}

function activityPhrase(item: { title: string; text?: string | null }): string {
  if (item.title === 'job.created') return 'opened this job file';
  const title = cleanMentionTitle(item.title);
  if (!title) return '';
  const phrase = `${title.charAt(0).toLowerCase()}${title.slice(1)}`.replace(/\.$/, '');
  return phrase;
}

function actSentence(day: string, phrases: string[], subject: string): string {
  const unique = [...new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean))];
  if (!unique.length) return '';
  const body =
    unique.length === 1
      ? unique[0]!
      : `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
  const when = day || 'Undated';
  return `${when}: ${subject} ${body}.`;
}

interface ActGroup {
  sort: string;
  day: string;
  lastMs: number;
  phrases: string[];
}

function groupActs(items: RankedMentionItem[], timeZone: string): ActGroup[] {
  const groups: ActGroup[] = [];
  const sorted = [...items].sort(chrono);
  for (const item of sorted) {
    const phrase = activityPhrase(item);
    if (!phrase) continue;
    const stamp = prettyMentionStamp(item.at || item.workDate, timeZone);
    if (!stamp.day) continue;
    const sort = item.at || item.workDate || '9999';
    const ms = item.at ? Date.parse(item.at) : NaN;
    const prev = groups[groups.length - 1];
    const close =
      prev &&
      stamp.day &&
      prev.day === stamp.day &&
      Number.isFinite(ms) &&
      Number.isFinite(prev.lastMs) &&
      Math.abs(ms - prev.lastMs) <= 5 * 60 * 1000;
    if (close && prev) {
      prev.phrases.push(phrase);
      if (Number.isFinite(ms)) prev.lastMs = ms;
      continue;
    }
    groups.push({
      sort,
      day: stamp.day,
      lastMs: Number.isFinite(ms) ? ms : NaN,
      phrases: [phrase],
    });
  }
  return groups;
}

function clipStamp(item: { at?: string | null; workDate?: string | null }, timeZone: string): string {
  const timed = prettyMentionStamp(item.at, timeZone);
  if (timed.stamp) return timed.stamp;
  return prettyMentionStamp(item.workDate, timeZone).stamp;
}

function clipAnswerLine(video: RankedMentionItem, timeZone: string): string {
  const when = clipStamp(video, timeZone);
  const title = cleanMentionTitle(video.title);
  const duration = prettyDuration(video.durationSeconds);
  const bit = String(video.listLine ?? '').replace(/\s+/g, ' ').trim();
  const head = `${when ? `${when} — ` : ''}${title}${duration ? ` (${duration})` : ''}`;
  return bit ? `${head}. ${bit}` : `${head}.`;
}

/**
 * Factual briefing when no model is configured or the model call fails.
 * Lists what the file attributes to this person. It does not pick an answer
 * shape from the wording of the question, and it does not dump mic quotes.
 */
function personBriefing(
  person: PersonMentionContext,
  askerIsPerson: boolean,
): { text: string; sources: string[] } {
  const name = person.name.trim() || 'That person';
  const who = askerIsPerson ? 'you' : name;
  const zone = activityZone(person);
  const videos = person.items.filter((item) => item.kind === 'video' && item.captured).sort(chrono);
  const tagged = person.items.filter((item) => item.kind === 'video' && !item.captured).sort(chrono);
  const jobs = person.items.filter((item) => item.kind === 'job');
  const rest = person.items.filter((item) => item.kind !== 'video' && item.kind !== 'job');
  const scope = cleanMentionTitle(String(person.jobTitle ?? ''));
  const scopeKey = scope.toLowerCase();
  const jobLabels = [...new Set(jobs.map((item) => displayJobTitle(cleanMentionTitle(item.title))).filter(Boolean))];
  const extraJobs = scopeKey
    ? jobLabels.filter((title) => cleanMentionTitle(title).toLowerCase() !== scopeKey)
    : jobLabels;
  const opener = scope
    ? `On ${scope}, this is what the file attributes to ${who}. Anything not listed here is not in the file.`
    : `This is what the file attributes to ${who}. Anything not listed here is not in the file.`;
  const subject = askerIsPerson ? 'You' : name;
  const events: Array<{ sort: string; text: string }> = [
    ...videos.map((video) => ({
      sort: video.at || video.workDate || '',
      text: clipAnswerLine(video, zone),
    })),
    ...groupActs(rest, zone).map((group) => ({
      sort: group.sort,
      text: actSentence(group.day, group.phrases, subject),
    })),
  ].filter((event) => event.text);
  events.sort((a, b) => a.sort.localeCompare(b.sort) || a.text.localeCompare(b.text));
  const lines = events.map((event) => event.text);
  for (const video of tagged) {
    lines.push(`Named in ${cleanMentionTitle(video.title)}, which someone else recorded.`);
  }
  for (const title of extraJobs) lines.push(`Also on ${title}.`);
  const sources: string[] = [];
  for (const video of videos) {
    if (video.jobId && video.proofId) sources.push(videoSourceId(video.jobId, video.proofId, video.title));
    const date = clipDate(video);
    if (date) sources.push(`clip:${date}`);
  }
  for (const job of jobs) {
    if (!job.jobId) continue;
    const label = displayJobTitle(cleanMentionTitle(job.title)) || job.title;
    sources.push(jobSourceId(job.jobId, label));
  }
  return { text: [opener, ...lines].join('\n'), sources };
}

export interface PersonMentionContext {
  userId: string;
  handle: string;
  name: string;
  items: RankedMentionItem[];
  /** Other titles already on the open job, used when this person has no matching rows. */
  fileContains?: string[];
  /** Job title without the #number, when Ask is scoped to one job. */
  jobTitle?: string | null;
  /** IANA zone for clocks in the answer. Never format those clocks as UTC. */
  timeZone?: string | null;
  /** Every clip and file section on the scoped job, with this person's clips first. */
  jobFile?: string | null;
}

const STATE_WORD: Record<string, string> = {
  uploaded: 'uploaded',
  checked: 'checked',
  analysed: 'analysed',
  analyzed: 'analysed',
  accepted: 'accepted',
  rejected: 'rejected',
  done: 'done',
  todo: 'to do',
  in_progress: 'in progress',
  blocked: 'blocked',
};

function stateWord(status: string | null | undefined): string {
  const key = String(status ?? '').trim().toLowerCase();
  return STATE_WORD[key] || key.replace(/_/g, ' ');
}

function clipDate(item: { workDate?: string | null; at?: string | null }): string | null {
  if (item.workDate && /^\d{4}-\d{2}-\d{2}$/.test(item.workDate)) return item.workDate;
  if (item.at && /^\d{4}-\d{2}-\d{2}/.test(item.at)) return item.at.slice(0, 10);
  return null;
}

/**
 * Grounded briefing when no model is configured or the model call fails.
 * The question is not used to pick a template. Never emits raw [[web:…]] markup.
 */
export function answerFromMentionContext(
  question: string,
  people: PersonMentionContext[],
  options?: { askerUserId?: string | null },
): { answer: string; groundedOn: number } {
  void question;
  const named = people.filter((person) => person.userId);
  if (!named.length) {
    return { answer: 'No one in your organization matches that mention.', groundedOn: 0 };
  }

  const blocks: string[] = [];
  const sources: string[] = [];
  let groundedOn = 0;
  for (const person of named) {
    const briefing = personBriefing(person, options?.askerUserId === person.userId);
    blocks.push(briefing.text);
    sources.push(...briefing.sources);
    groundedOn += person.items.filter((item) => item.kind === 'video' && item.captured).length;
  }

  const uniqueSources = [...new Set(sources)];
  const prose = blocks.join('\n\n').replace(/\[\[\s*web:[\s\S]*?\]\]/gi, '').trim();
  const trailer = uniqueSources.length ? `\n\n⟦sources: ${uniqueSources.join(', ')}⟧` : '';
  return { answer: `${prose}${trailer}`.trim(), groundedOn };
}


export const MENTION_ASK_MARK = 'MENTION ASK';

/** Their clips get a longer transcript. Other clips stay short so the prompt fits. */
const PERSON_TRANSCRIPT_CAP = 1400;
const TAGGED_TRANSCRIPT_CAP = 700;
const OTHER_TRANSCRIPT_CAP = 400;
const TRANSCRIPT_BUDGET = 12_000;

/**
 * The model answers the question. These rules replace keyword templates.
 * Source chips use the trailer the Ask UI already strips into links.
 */
export const MENTION_MODEL_INSTRUCTIONS =
  'Answer the question the person actually asked, directly and naturally. ' +
  'That includes a broad "what did I do", a specific quote or topic, a yes/no, a comparison, and a follow-up that only uses he, she, or they. ' +
  'Do not force a chronological rundown, a "filmed N clips" list, or a canned "doesn\'t have that on file" sentence. ' +
  'The attribution dossier says which clips and actions are theirs and which belong to someone else. ' +
  'The job file has every clip\'s summary, findings, timed transcript, and speakers, plus parties, job history, shares, and notes. ' +
  'Recent conversation turns resolve follow-ups. ' +
  'Stay strictly grounded. Never invent clips, quotes, times, people, rooms, or events. ' +
  'If the file does not contain the answer, say plainly that it is not in the file. ' +
  'Cite each claim with the existing source chips. After the prose, append exactly one machine line the UI strips into chips: ' +
  '⟦sources: job/<jobId>/<slug>, video/<jobId>/<proofId>/<slug>, clip:YYYY-MM-DD⟧. ' +
  'Do not put that line, raw tags, or "(Source: …)" inside the sentences. ' +
  'Times in the dossier are already in the asker\'s timezone. Do not rewrite them as UTC. ' +
  'Address the asker as "you" only when the dossier says to. ' +
  'A clip marked as someone else recorded was not filmed by this person. ' +
  'Never write [[web:…]].';

/** System-prompt addendum for a mention supplement. */
export function activitySystemAddendum(supplement: string): string | null {
  if (!/\bMENTION ASK\b|\bATTRIBUTION DOSSIER\b|\bMENTIONED PEOPLE\b/.test(supplement)) return null;
  return (
    `\n\nThe question @mentions a coworker, or a follow-up pronoun refers to the last person they named. ` +
    MENTION_MODEL_INSTRUCTIONS
  );
}

/** Keep timestamp markers. Cut on a line or sentence when the cap would land mid-word. */
export function trimMentionTranscript(text: unknown, cap: number): string {
  const raw = String(text ?? '').replace(/\r/g, '').trim();
  if (!raw || cap <= 0) return '';
  if (raw.length <= cap) return raw;
  const cut = raw.slice(0, cap);
  const boundary = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('. '));
  const kept = boundary > cap * 0.55 ? cut.slice(0, boundary) : cut.replace(/\s+\S*$/, '');
  return `${kept.trim()}…`;
}

/** Speaker labels stored on a clip's findings, when the file has them. */
export function mentionSpeakerLine(findings: unknown): string {
  if (!findings || typeof findings !== 'object') return '';
  const root = findings as Record<string, unknown>;
  const block =
    root.people && typeof root.people === 'object' ? (root.people as Record<string, unknown>) : root;
  const speakers = Array.isArray(block.speakers) ? block.speakers : [];
  const fromSpeakers = speakers
    .map((row) => {
      if (!row || typeof row !== 'object') return '';
      const speaker = row as { displayName?: unknown; speakerLabel?: unknown };
      return String(speaker.displayName || speaker.speakerLabel || '').trim();
    })
    .filter(Boolean);
  if (fromSpeakers.length) return [...new Set(fromSpeakers)].join(', ');
  const present = Array.isArray(block.people)
    ? block.people
    : Array.isArray(root.peoplePresent)
      ? root.peoplePresent
      : [];
  const labels = present
    .map((row) => {
      if (!row || typeof row !== 'object') return '';
      const person = row as { displayName?: unknown; label?: unknown };
      return String(person.displayName || person.label || '').trim();
    })
    .filter(Boolean);
  return [...new Set(labels)].join(', ');
}

function proofFindingText(findings: unknown): string {
  if (!findings || typeof findings !== 'object') return '';
  const events = (findings as { events?: unknown }).events;
  const lines = Array.isArray(events)
    ? events
        .map((event) => {
          if (!event || typeof event !== 'object') return '';
          return String((event as { text?: unknown }).text ?? '')
            .replace(/\s+/g, ' ')
            .trim();
        })
        .filter(Boolean)
    : [];
  return trimMentionTranscript(lines.join(' '), 1600);
}

function clipPriority(
  proofId: string,
  people: PersonMentionContext[],
): { rank: number; label: string } {
  for (const person of people) {
    const item = person.items.find((row) => row.kind === 'video' && row.proofId === proofId);
    if (!item) continue;
    if (item.captured) return { rank: 0, label: `recorded by ${person.name}` };
    return { rank: 1, label: `names ${person.name}; someone else recorded it` };
  }
  return { rank: 2, label: 'someone else recorded it' };
}

function citeForItem(item: { kind: string; jobId?: string | null; proofId?: string | null; title: string; workDate?: string | null; at?: string | null }): string {
  const ids: string[] = [];
  if (item.kind === 'video' && item.jobId && item.proofId) ids.push(videoSourceId(item.jobId, item.proofId, item.title));
  if (item.kind === 'job' && item.jobId) ids.push(jobSourceId(item.jobId, item.title));
  const date = clipDate(item);
  if (item.kind === 'video' && date) ids.push(`clip:${date}`);
  return ids.join(', ');
}

function formatPersonAttribution(person: PersonMentionContext, askerUserId?: string | null): string {
  const asker = askerUserId === person.userId;
  const header = [
    `ATTRIBUTION DOSSIER for ${person.name} (${person.userId})`,
    person.jobTitle ? `Job: ${person.jobTitle}` : '',
    asker
      ? 'The asker is this person. Address them as "you".'
      : `Address them as ${person.name}. Do not switch to "you".`,
    personHasActivity(person)
      ? 'Clips under "Recorded by this person" are theirs. Clips under "Someone else recorded" are not.'
      : 'Nothing on this file was recorded by this person.',
  ]
    .filter(Boolean)
    .join('\n');
  const zone = activityZone(person);
  const recorded = person.items.filter((item) => item.kind === 'video' && item.captured).sort(chrono);
  const tagged = person.items.filter((item) => item.kind === 'video' && !item.captured).sort(chrono);
  const jobs = person.items.filter((item) => item.kind === 'job');
  const rest = person.items.filter((item) => item.kind !== 'video' && item.kind !== 'job');
  const lines: string[] = ['Recorded by this person:'];
  if (!recorded.length) lines.push('- none');
  for (const video of recorded) {
    const cite = citeForItem(video);
    const finding = String(video.finding ?? '').replace(/\s+/g, ' ').trim();
    lines.push(`- ${clipAnswerLine(video, zone)}`);
    if (finding && !clipAnswerLine(video, zone).includes(finding)) lines.push(`  Finding: ${finding}`);
    if (video.speakers) lines.push(`  Speakers: ${video.speakers}`);
    if (cite) lines.push(`  Cite: ${cite}`);
    if (video.proofId) lines.push(`  priority-clip:${video.proofId}`);
  }
  lines.push('Someone else recorded:');
  if (!tagged.length) lines.push('- none');
  for (const video of tagged) {
    const cite = citeForItem(video);
    lines.push(`- Named in ${cleanMentionTitle(video.title)}, which someone else recorded.`);
    if (cite) lines.push(`  Cite: ${cite}`);
  }
  const subject = asker ? 'You' : person.name;
  const acts = groupActs(rest, zone)
    .map((group) => actSentence(group.day, group.phrases, subject))
    .filter(Boolean);
  lines.push('Other actions:');
  lines.push(acts.length ? acts.map((line) => `- ${line}`).join('\n') : '- none');
  const scope = cleanMentionTitle(String(person.jobTitle ?? '')).toLowerCase();
  const also = jobs
    .map((job) => {
      const title = displayJobTitle(cleanMentionTitle(job.title));
      if (!title) return '';
      if (scope && cleanMentionTitle(title).toLowerCase() === scope) return '';
      return `- Also on ${title}${job.status ? ` (${stateWord(job.status)})` : ''}.`;
    })
    .filter(Boolean);
  if (also.length) lines.push(also.join('\n'));
  return `${header}\n${lines.join('\n')}`;
}

export interface MentionJobFileInput {
  timeZone?: string | null;
  jobs: Array<{
    id?: string;
    job_number?: number | string | null;
    title?: string | null;
    status?: string | null;
    work_type?: string | null;
  }>;
  proofs: Array<Record<string, unknown>>;
  parties: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  shares: Array<Record<string, unknown>>;
  memory: Array<Record<string, unknown>>;
  people: PersonMentionContext[];
}

/** Whole job file for the model: their clips first, transcripts trimmed to a budget. */
export function formatMentionJobFile(input: MentionJobFileInput): string {
  const zone = mentionTimeZone(input.timeZone);
  const sections: string[] = ['JOB FILE'];
  if (input.jobs.length) {
    sections.push(
      input.jobs
        .map((job) => {
          const title = [job.job_number != null && job.job_number !== '' ? `#${job.job_number}` : '', job.title]
            .filter(Boolean)
            .join(' ');
          return `Job: ${title || 'Job'}${job.status ? ` (${job.status})` : ''}${job.work_type ? ` · ${job.work_type}` : ''}`;
        })
        .join('\n'),
    );
  }

  const parties = input.parties
    .map((party) => {
      const company = String(party.company ?? '').trim();
      if (!company) return '';
      const trade = String(party.trade ?? '').trim();
      return `- ${[company, trade].filter(Boolean).join(' · ')}`;
    })
    .filter(Boolean);
  sections.push(parties.length ? `Parties:\n${parties.join('\n')}` : 'Parties:\nnone');

  const ranked = input.proofs
    .map((proof) => {
      const id = String(proof.id ?? '');
      const priority = clipPriority(id, input.people);
      return { proof, ...priority };
    })
    .sort((a, b) => a.rank - b.rank || String(a.proof.captured_at ?? a.proof.work_date ?? '').localeCompare(String(b.proof.captured_at ?? b.proof.work_date ?? '')));

  let budget = TRANSCRIPT_BUDGET;
  const clipLines: string[] = [];
  for (const row of ranked) {
    const proof = row.proof;
    const title = cleanMentionTitle(String(proof.title ?? 'Clip'));
    const when = prettyMentionStamp(String(proof.captured_at ?? proof.work_date ?? ''), zone).stamp;
    const summary = String(proof.ai_summary ?? proof.narration_text ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    const finding = proofFindingText(proof.ai_findings);
    const speakers = mentionSpeakerLine(proof.ai_findings);
    const cap = row.rank === 0 ? PERSON_TRANSCRIPT_CAP : row.rank === 1 ? TAGGED_TRANSCRIPT_CAP : OTHER_TRANSCRIPT_CAP;
    const transcript = trimMentionTranscript(proof.transcript_text, Math.min(cap, budget));
    budget -= transcript.length;
    const jobId = String(proof.job_id ?? '');
    const proofId = String(proof.id ?? '');
    const cite = jobId && proofId ? videoSourceId(jobId, proofId, title) : '';
    const date = /^\d{4}-\d{2}-\d{2}/.test(String(proof.work_date ?? '')) ? String(proof.work_date).slice(0, 10) : '';
    const bits = [
      `- ${when ? `${when} — ` : ''}${title} (${row.label})`,
      cite ? `  Cite: ${cite}${date ? `, clip:${date}` : ''}` : '',
      summary ? `  Summary: ${summary}` : '',
      finding ? `  Findings: ${finding}` : '  Findings: none on file',
      speakers ? `  Speakers: ${speakers}` : '  Speakers: not identified on this clip',
      transcript ? `  Timed transcript: ${transcript}` : '  Timed transcript: none on file',
    ].filter(Boolean);
    clipLines.push(bits.join('\n'));
  }
  sections.push(clipLines.length ? `Clips (this person's first):\n${clipLines.join('\n')}` : 'Clips:\nnone');

  const history = input.memory
    .map((event) => {
      const summary = String(event.summary ?? '').trim();
      if (!summary) return '';
      const when = prettyMentionStamp(String(event.occurred_at ?? ''), zone).stamp;
      return `- ${when ? `${when} — ` : ''}${summary}`;
    })
    .filter(Boolean);
  sections.push(history.length ? `Job history:\n${history.join('\n')}` : 'Job history:\nnone');

  const shares = input.shares
    .map((share) => {
      const label = String(share.label ?? 'someone').trim();
      const when = prettyMentionStamp(String(share.created_at ?? ''), zone).stamp;
      const state = share.revoked_at ? 'revoked' : 'open';
      return `- ${when ? `${when} — ` : ''}Shared with ${label} (${state})`;
    })
    .filter(Boolean);
  sections.push(shares.length ? `Shares:\n${shares.join('\n')}` : 'Shares:\nnone');

  const notes = input.messages
    .map((message) => {
      const body = String(message.body ?? '').replace(/\s+/g, ' ').trim();
      if (!body) return '';
      const author = String(message.author_label ?? 'Note').trim();
      const when = prettyMentionStamp(String(message.created_at ?? ''), zone).stamp;
      return `- ${when ? `${when} — ` : ''}${author}: ${body.slice(0, 400)}`;
    })
    .filter(Boolean)
    .slice(0, 40);
  sections.push(notes.length ? `Notes:\n${notes.join('\n')}` : 'Notes:\nnone');

  return sections.join('\n\n');
}

export function formatMentionModelContext(input: {
  people: PersonMentionContext[];
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  askerUserId?: string | null;
}): string {
  if (!input.people.length) return '';
  const dossiers = input.people.map((person) => formatPersonAttribution(person, input.askerUserId));
  const jobFile = input.people.map((person) => String(person.jobFile ?? '').trim()).find(Boolean) || 'JOB FILE\nnone loaded';
  const history = (input.history ?? [])
    .filter((turn) => String(turn.text ?? '').trim())
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${String(turn.text).trim()}`)
    .join('\n');
  return [
    MENTION_ASK_MARK,
    dossiers.join('\n\n'),
    jobFile,
    history ? `RECENT CONVERSATION\n${history}` : 'RECENT CONVERSATION\nnone',
    MENTION_MODEL_INSTRUCTIONS,
  ].join('\n\n');
}

/**
 * True when `body` names this person. A stored mention id counts.
 * A typed name counts only when it resolves to this one person — `@John`
 * with two Johns tags neither of them.
 */
export function textMentionsPerson(body: string, userId: string, roster: MentionMember[]): boolean {
  const id = userId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`@\\[[^\\]\\n]{1,80}\\]\\(mention:${id}\\)`).test(body)) return true;
  return resolveMentions(body, roster).mentions.some((mention) => mention.userId === userId);
}
