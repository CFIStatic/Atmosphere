/**
 * @mentions for Ask.
 *
 * Handles are stable within an org. A stored profiles.handle wins; otherwise
 * one is derived from the name, then the email local part, and collisions get
 * a numeric suffix ordered by user id so the same roster always yields the
 * same handles.
 *
 * Client-supplied user ids are never trusted. Resolution only returns people
 * who are in the roster passed in — callers load that roster through the
 * caller's org-scoped client.
 */

export interface MentionIdentity {
  userId: string;
  email?: string | null;
  fullName?: string | null;
  /** Existing stored handle, when the profile already has one. */
  handle?: string | null;
}

export interface MentionMember extends MentionIdentity {
  handle: string;
}

export interface ParsedMention {
  handle: string;
  /** Id the client claimed. Ignored unless that id is in the org roster. */
  claimedUserId: string | null;
  index: number;
}

export interface ResolvedMention {
  userId: string;
  handle: string;
  name: string;
}

const HANDLE_RE = /^[a-z0-9][a-z0-9_]{1,31}$/;
const STRUCTURED_RE = /@\[([A-Za-z0-9][A-Za-z0-9_]{1,31})\]\(mention:([A-Za-z0-9_-]{1,64})\)/g;
const BARE_RE = /(^|[\s(])@([A-Za-z0-9][A-Za-z0-9_]{1,31})\b/g;

const TOPIC_STOP = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'to', 'and', 'or', 'did', 'does', 'do', 'is', 'was',
  'are', 'were', 'this', 'that', 'it', 'any', 'what', 'when', 'where', 'how', 'who', 'why',
  'he', 'she', 'they', 'him', 'her', 'his', 'their', 'finish', 'finished', 'finishing',
  'complete', 'completed', 'done', 'please', 'about', 'for', 'with', 'from', 'has', 'have',
  'had', 'been', 'being', 'me', 'tell', 'show',
]);

const RANK_STOP = new Set([...TOPIC_STOP, 'job', 'jobs', 'work', 'video', 'videos', 'clip', 'clips']);

export function normalizeHandle(raw: unknown): string | null {
  const compact = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!HANDLE_RE.test(compact)) return null;
  return compact;
}

/** Prefer a stored handle, then a name slug, then the email local part. */
export function handleBase(input: MentionIdentity): string {
  const existing = normalizeHandle(input.handle);
  if (existing) return existing;
  const fromName = String(input.fullName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (fromName.length >= 2) return fromName.slice(0, 32);
  const local = String(input.email ?? '')
    .split('@')[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (local && local.length >= 2) return local.slice(0, 32);
  return 'member';
}

function withSuffix(base: string, n: number): string {
  if (n <= 1) return base.slice(0, 32);
  const suffix = String(n);
  return `${base.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
}

/**
 * Assign one handle per member. Explicit stored handles that are unique in
 * the org are kept. Everyone else is derived, and ties break by user id so
 * the result does not depend on query order.
 */
export function assignOrgHandles<T extends MentionIdentity>(members: T[]): Array<T & { handle: string }> {
  const sorted = [...members].sort((a, b) => a.userId.localeCompare(b.userId));
  const used = new Set<string>();
  const assigned = new Map<string, string>();

  for (const member of sorted) {
    const explicit = normalizeHandle(member.handle);
    if (!explicit || used.has(explicit)) continue;
    used.add(explicit);
    assigned.set(member.userId, explicit);
  }

  for (const member of sorted) {
    if (assigned.has(member.userId)) continue;
    const base = handleBase({ ...member, handle: null });
    let n = 1;
    let handle = withSuffix(base, n);
    while (used.has(handle)) {
      n += 1;
      handle = withSuffix(base, n);
    }
    used.add(handle);
    assigned.set(member.userId, handle);
  }

  return members.map((member) => ({ ...member, handle: assigned.get(member.userId) ?? 'member' }));
}

export function parseMentions(text: string): ParsedMention[] {
  const source = String(text ?? '');
  const covered: Array<[number, number]> = [];
  const found: ParsedMention[] = [];

  for (const match of source.matchAll(STRUCTURED_RE)) {
    const index = match.index ?? 0;
    found.push({
      handle: match[1].toLowerCase(),
      claimedUserId: match[2],
      index,
    });
    covered.push([index, index + match[0].length]);
  }

  for (const match of source.matchAll(BARE_RE)) {
    const lead = match[1] ?? '';
    const index = (match.index ?? 0) + lead.length;
    if (covered.some(([start, end]) => index >= start && index < end)) continue;
    found.push({
      handle: match[2].toLowerCase(),
      claimedUserId: null,
      index,
    });
  }

  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  return found.filter((mention) => {
    if (seen.has(mention.handle)) return false;
    seen.add(mention.handle);
    return true;
  });
}

export function mentionToken(handle: string, userId: string): string {
  return `@[${handle}](mention:${userId})`;
}

/**
 * Resolve every mention against one org roster.
 * A claimed id from outside the roster is dropped. When the handle matches
 * someone in the roster, that member wins even if the client sent a different id.
 */
export function resolveMentions(text: string, roster: MentionMember[]): ResolvedMention[] {
  const byHandle = new Map(roster.map((member) => [member.handle, member]));
  const byId = new Map(roster.map((member) => [member.userId, member]));
  const resolved: ResolvedMention[] = [];
  const seen = new Set<string>();

  for (const parsed of parseMentions(text)) {
    const named = byHandle.get(parsed.handle) ?? null;
    const claimed = parsed.claimedUserId ? byId.get(parsed.claimedUserId) ?? null : null;
    const member = named ?? (claimed && claimed.handle === parsed.handle ? claimed : null);
    if (!member || seen.has(member.userId)) continue;
    seen.add(member.userId);
    const name = String(member.fullName ?? '').trim() || member.handle;
    resolved.push({ userId: member.userId, handle: member.handle, name });
  }
  return resolved;
}

export function firstName(name: string, handle: string): string {
  const part = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0];
  if (part) return part;
  return handle;
}

/** "did he finish the electrical job?" → "electrical job". */
export function topicFromQuestion(question: string): string {
  const stripped = String(question ?? '')
    .replace(STRUCTURED_RE, ' ')
    .replace(BARE_RE, ' ');
  const words = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !TOPIC_STOP.has(word));
  return words.slice(0, 6).join(' ');
}

export function questionTokens(question: string): string[] {
  const stripped = String(question ?? '')
    .replace(STRUCTURED_RE, ' ')
    .replace(BARE_RE, ' ');
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

export function rankMentionItems(
  items: MentionItem[],
  question: string,
  now: Date = new Date(),
): RankedMentionItem[] {
  const tokens = questionTokens(question);
  const nowMs = now.getTime();
  const ranked = items.map((item) => {
    const hay = `${item.title} ${item.text} ${item.status ?? ''}`.toLowerCase();
    const hits = tokens.filter((token) => hay.includes(token)).length;
    const relevance = tokens.length ? hits / tokens.length : 1;
    const relevant = tokens.length ? hits > 0 : true;
    const score = relevance * 0.72 + recencyScore(item.at, nowMs) * 0.28 + (item.captured ? 0.04 : 0);
    return { ...item, score, relevant };
  });
  return ranked
    .filter((item) => item.relevant)
    .sort((a, b) => b.score - a.score || String(b.at ?? '').localeCompare(String(a.at ?? '')));
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

export function noEvidenceSentence(person: { name: string; handle: string }, question: string): string {
  const who = firstName(person.name, person.handle);
  const topic = topicFromQuestion(question);
  if (topic) return `No ${topic} found for ${who}.`;
  return `No evidence found for ${who}.`;
}

export interface PersonMentionContext {
  userId: string;
  handle: string;
  name: string;
  items: RankedMentionItem[];
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
    const items = person.items.filter((item) => item.relevant).slice(0, 6);
    if (!items.length) {
      blocks.push(noEvidenceSentence(person, question));
      continue;
    }
    const who = firstName(person.name, person.handle);
    const lines = items.map((item) => {
      groundedOn += 1;
      const when = clipDate(item);
      const status = stateWord(item.status);
      if (item.kind === 'job' && item.jobId) {
        sources.push(jobSourceId(item.jobId, item.title));
        return `${item.title}${status ? ` (${status})` : ''}${when ? `, updated ${when}` : ''}`;
      }
      if (item.kind === 'video' && item.jobId && item.proofId) {
        sources.push(videoSourceId(item.jobId, item.proofId, item.title));
        if (when) sources.push(`clip:${when}`);
        const bit = item.text ? ` ${item.text.slice(0, 220).trim()}` : '';
        return `${item.title}${when ? ` on ${when}` : ''}${status ? `, ${status}` : ''}.${bit}`.trim();
      }
      if (item.kind === 'note') sources.push('notes');
      if (item.kind === 'task') sources.push('task');
      if (item.kind === 'log') sources.push('log');
      return `${item.title}${status ? ` (${status})` : ''}${item.text ? `: ${item.text.slice(0, 220).trim()}` : ''}`;
    });
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
    const header = `@${person.handle} — ${person.name} (${person.userId})`;
    if (!person.items.length) {
      return `${header}\nNo jobs, videos, notes, or tags tied to this person in this organization.`;
    }
    const lines = person.items.slice(0, 8).map((item) => {
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
    `When the question @mentions someone, use only the evidence above for that person. ` +
    `Cite the specific jobs and videos with one machine line the UI turns into links: ` +
    `⟦sources: job/<jobId>/<slug>, video/<jobId>/<proofId>/<slug>, clip:YYYY-MM-DD⟧. ` +
    `If this section does not contain the asked work, say so in one plain sentence such as ` +
    `"No electrical job found for John" and do not guess. Never write [[web:…]] or any raw web citation markup.`
  );
}

export function textMentionsHandle(body: string, handle: string): boolean {
  const safe = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bare = new RegExp(`(^|[\\s(])@${safe}\\b`, 'i');
  const structured = new RegExp(`@\\[${safe}\\]\\(mention:`, 'i');
  return bare.test(body) || structured.test(body);
}
