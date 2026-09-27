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

/**
 * Case-insensitive prefix of the full name or of any word in it.
 * `@jo` matches "John Cyganiak"; `@cyg` matches the last name; `@john c` matches the full name.
 */
export function nameMatchesQuery(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q || !name.trim()) return false;
  const full = name.trim().toLowerCase();
  if (full.startsWith(q)) return true;
  const qWord = q.split(/\s+/)[0] ?? q;
  return nameWords(name).some((word) => word.startsWith(qWord) && (q === qWord || full.startsWith(q)));
}

function boundaryAfter(text: string, length: number): boolean {
  const next = text[length] ?? '';
  return next === '' || /[\s,.;:!?)]/.test(next);
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
    const matches = membersMatching(token[0], roster);
    if (matches.length === 1) pushMember(matches[0]!);
    else if (matches.length > 1) pushAmbiguous(token[0], matches);
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
    text = text.replace(new RegExp(`(^|[\\s(])@${escaped}(?=$|[\\s,.;:!?])`, 'gi'), '$1 ');
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

/** Questions that want the person's clips, not a keyword hit inside one of them. */
export function asksForPersonRecord(question: string, names: string[] = []): boolean {
  const q = stripMentionMarks(question, names).toLowerCase();
  if (/\btake a video\b/.test(q)) return true;
  // "in the videos about the leak" looks inside a clip. Listing them is "which clips" / "what videos".
  if (/\b(in|from|during|on)\s+(the\s+|those\s+|these\s+)?(clips?|videos?|films?|footage|proofs?|uploads?)\b/.test(q)) {
    return false;
  }
  return /\b(which|what|list|show|all)\b[\s\S]{0,60}\b(clips?|videos?|films?|footage|proofs?|uploads?)\b/.test(q);
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
  /** One sentence plus one visual detail. Shown in clip lists; omits raw mic quotes. */
  listLine?: string | null;
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

/** Natural miss. Uses the full name and names what is actually on file. */
export function unmatchedMentionSentence(name: string, contained: string[]): string {
  const who = name.trim() || 'That person';
  const titles = [...new Set(contained.map((item) => item.trim()).filter(Boolean))].slice(0, 8);
  if (!titles.length) return `${who} doesn't have anything matching that on this job file.`;
  const list =
    titles.length === 1
      ? titles[0]!
      : `${titles.slice(0, -1).join('; ')}; and ${titles[titles.length - 1]}`;
  return `${who} doesn't have that on file. What's here: ${list}.`;
}

export interface PersonMentionContext {
  userId: string;
  handle: string;
  name: string;
  items: RankedMentionItem[];
  /** Other titles already on the open job, used when this person has no matching rows. */
  fileContains?: string[];
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

function describeItem(
  item: RankedMentionItem,
  sources: string[],
  count: () => void,
): string {
  count();
  const when = clipDate(item);
  const status = stateWord(item.status);
  if (item.kind === 'job' && item.jobId) {
    sources.push(jobSourceId(item.jobId, item.title));
    return `${item.title}${status ? ` (${status})` : ''}${when ? `, updated ${when}` : ''}`;
  }
  if (item.kind === 'video' && item.jobId && item.proofId) {
    sources.push(videoSourceId(item.jobId, item.proofId, item.title));
    if (when) sources.push(`clip:${when}`);
    const bit = String(item.listLine ?? '').replace(/\s+/g, ' ').trim();
    return `${when ? `${when} — ` : ''}${item.title}${status ? ` (${status})` : ''}${bit ? `. ${bit}` : ''}`.trim();
  }
  if (item.kind === 'note') sources.push('notes');
  if (item.kind === 'task') sources.push('task');
  if (item.kind === 'log') sources.push('log');
  return `${item.title}${status ? ` (${status})` : ''}${item.text ? `: ${item.text.slice(0, 280).trim()}` : ''}`;
}

function clipDate(item: RankedMentionItem): string | null {
  if (item.workDate && /^\d{4}-\d{2}-\d{2}$/.test(item.workDate)) return item.workDate;
  if (item.at && /^\d{4}-\d{2}-\d{2}/.test(item.at)) return item.at.slice(0, 10);
  return null;
}

/**
 * Grounded prose when the model is not configured, and the sentence used when
 * nothing relevant is on file. Never emits raw [[web:…]] markup.
 */
export function answerFromMentionContext(
  question: string,
  people: PersonMentionContext[],
): { answer: string; groundedOn: number } {
  const named = people.filter((person) => person.userId);
  if (!named.length) {
    return { answer: 'No one in your organization matches that mention.', groundedOn: 0 };
  }

  const blocks: string[] = [];
  const sources: string[] = [];
  let groundedOn = 0;

  for (const person of named) {
    const who = person.name.trim() || 'That person';
    const videos = person.items.filter((item) => item.kind === 'video').slice(0, 20);
    const inventory = asksForPersonRecord(question, [person.name]);
    if (inventory && videos.length) {
      const lines = videos.map((item) => describeItem(item, sources, () => { groundedOn += 1; }));
      const noun = videos.length === 1 ? 'clip' : 'clips';
      blocks.push(`${who} filmed ${videos.length} ${noun} on file.\n${lines.map((line) => `- ${line}`).join('\n')}`);
      continue;
    }
    const topical = person.items.filter((item) => item.relevant).slice(0, 12);
    if (!topical.length) {
      const contained = person.items.length
        ? person.items.map((item) => item.title)
        : (person.fileContains ?? []);
      blocks.push(unmatchedMentionSentence(who, contained));
      continue;
    }
    const lines = topical.map((item) => describeItem(item, sources, () => { groundedOn += 1; }));
    blocks.push(`${who}: ${lines.join(' ')}`);
  }

  const uniqueSources = [...new Set(sources)];
  const prose = blocks.join('\n\n').replace(/\[\[\s*web:[\s\S]*?\]\]/gi, '').trim();
  const trailer = uniqueSources.length ? `\n\n⟦sources: ${uniqueSources.join(', ')}⟧` : '';
  return { answer: `${prose}${trailer}`.trim(), groundedOn };
}

export function formatMentionPrompt(people: PersonMentionContext[]): string {
  if (!people.length) return '';
  const sections = people.map((person) => {
    const header = `@${person.name} (${person.userId})`;
    if (!person.items.length) {
      return `${header}\nNo jobs, videos, notes, or tags tied to this person in this organization.`;
    }
    const lines = person.items.slice(0, 24).map((item) => {
      const cite =
        item.kind === 'job' && item.jobId
          ? jobSourceId(item.jobId, item.title)
          : item.kind === 'video' && item.jobId && item.proofId
            ? videoSourceId(item.jobId, item.proofId, item.title)
            : item.kind;
      const when = item.at ? item.at.slice(0, 10) : 'undated';
      const status = stateWord(item.status);
      return `- [${cite}] ${item.kind} ${when}${status ? ` ${status}` : ''}: ${item.title}. ${item.text.slice(0, 500)}`;
    });
    return `${header}\n${lines.join('\n')}`;
  });

  return (
    `MENTIONED PEOPLE (only people in this organization; answer @questions from this section):\n` +
    `${sections.join('\n\n')}\n\n` +
    `The list above is everything tied to that person on this job, not a sample. ` +
    `Use their full name. When they ask which clips or videos that person filmed, name every clip in the list. ` +
    `Use the rest of the job file for supporting detail. ` +
    `Cite jobs and videos with one machine line the UI turns into links: ` +
    `⟦sources: job/<jobId>/<slug>, video/<jobId>/<proofId>/<slug>, clip:YYYY-MM-DD⟧. ` +
    `If the asked detail is not on file, say so in a natural sentence that uses the person's full name and list what is on file. ` +
    `Do not answer with "No <words from the question> found for <first name>". ` +
    `Never write [[web:…]] or any raw web citation markup.`
  );
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
