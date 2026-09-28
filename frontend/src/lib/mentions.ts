/**
 * Client side of @mentions. A mention is the person's name (profile, or the
 * login name the server already folded into fullName). The server re-checks
 * every name against the caller's org.
 */

export interface MentionMember {
  userId: string;
  fullName?: string | null;
  loginName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

const STRUCTURED_RE = /@\[([^\]\n]{1,80})\]\(mention:([A-Za-z0-9_-]{1,64})\)/g;

export function mentionDisplayName(input: {
  fullName?: string | null;
  loginName?: string | null;
}): string {
  const profile = String(input.fullName ?? '').replace(/\s+/g, ' ').trim();
  if (profile) return profile;
  return String(input.loginName ?? '').replace(/\s+/g, ' ').trim();
}

export function nameKey(name: string): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function mentionToken(name: string, userId: string): string {
  return `@[${name}](mention:${userId})`;
}

const MENTION_CHIP_RE = /@\[([^\]\n]{0,80})\](?:\(mention:[^)\n]*)?\)?/g;
const MENTION_TRUNCATED_RE = /@\[([^\]\n]{1,80})/g;

/** `@[El Presidente](mention:uuid)`, including a title cut off mid-token, becomes `@El Presidente`. */
export function displayMentionText(value: string): string {
  let text = String(value ?? '');
  text = text.replace(MENTION_CHIP_RE, (_match, name: string) => {
    const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
    return clean ? `@${clean}` : '';
  });
  text = text.replace(MENTION_TRUNCATED_RE, (_match, name: string) => {
    const clean = String(name ?? '').replace(/[….]+$/g, '').replace(/\s+/g, ' ').trim();
    return clean ? `@${clean}` : '';
  });
  text = text.replace(/\(mention:[^)\n]*\)?/gi, '');
  text = text.replace(/\bmention:[A-Za-z0-9_-]{4,}/gi, '');
  return text.replace(/[ \t]{2,}/g, ' ').trim();
}

function nameWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]+/g, ''))
    .filter(Boolean);
}

/** Prefix of the full name or of any word. `@jo` and `@cyg` both match "John Cyganiak". */
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

/** Replace a uniquely matching @name with a token that stores the user id. */
export function expandMentionTokens(text: string, members: MentionMember[]): string {
  const source = String(text ?? '');
  const covered: Array<[number, number]> = [];
  for (const match of source.matchAll(new RegExp(STRUCTURED_RE.source, 'g'))) {
    const index = match.index ?? 0;
    covered.push([index, index + match[0].length]);
  }
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const mark of source.matchAll(/(^|[\s(])@/g)) {
    const lead = mark[1] ?? '';
    const index = (mark.index ?? 0) + lead.length;
    if (covered.some(([start, end]) => index >= start && index < end)) continue;
    const rest = source.slice(index + 1);
    let best: { length: number; matches: MentionMember[] } | null = null;
    for (const member of members) {
      const name = mentionDisplayName(member);
      if (name.length < 2) continue;
      if (!rest.toLowerCase().startsWith(name.toLowerCase())) continue;
      if (!boundaryAfter(rest, name.length)) continue;
      if (!best || name.length > best.length) {
        best = {
          length: name.length,
          matches: members.filter((row) => mentionDisplayName(row).toLowerCase() === name.toLowerCase()),
        };
      }
    }
    if (best) {
      if (best.matches.length === 1) {
        const member = best.matches[0]!;
        replacements.push({
          start: index,
          end: index + 1 + best.length,
          text: mentionToken(mentionDisplayName(member), member.userId),
        });
      }
      continue;
    }
    const token = rest.match(/^[A-Za-z0-9][A-Za-z0-9'’.\-]{0,60}/);
    if (!token) continue;
    const matches = membersMatching(token[0], members);
    if (matches.length !== 1) continue;
    const member = matches[0]!;
    replacements.push({
      start: index,
      end: index + 1 + token[0].length,
      text: mentionToken(mentionDisplayName(member), member.userId),
    });
  }
  let out = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, replacement.start) + replacement.text + out.slice(replacement.end);
  }
  return out;
}

export function mentionQueryAt(
  text: string,
  cursor: number,
  members: MentionMember[] = [],
): { start: number; end: number; query: string } | null {
  const upto = text.slice(0, cursor);
  const match = upto.match(/(^|[\s(])@([A-Za-z0-9'’.\- ]{0,80})$/);
  if (!match) return null;
  const raw = match[2] ?? '';
  const trimmed = raw.trim();
  if (/\s$/.test(raw) && members.length) {
    const exact = members.some((member) => mentionDisplayName(member).toLowerCase() === trimmed.toLowerCase());
    const longer = members.some((member) =>
      mentionDisplayName(member).toLowerCase().startsWith(`${trimmed.toLowerCase()} `),
    );
    if (exact || !longer) return null;
  }
  if (
    trimmed.includes(' ') &&
    members.length &&
    !members.some((member) => mentionDisplayName(member).toLowerCase().startsWith(trimmed.toLowerCase()))
  ) {
    return null;
  }
  const start = upto.length - raw.length - 1;
  return { start, end: cursor, query: raw.replace(/\s+$/, '') };
}

export function filterMentionMembers(members: MentionMember[], query: string): MentionMember[] {
  const q = query.trim();
  const matched = members.filter((member) => {
    const name = mentionDisplayName(member);
    if (name.length < 2) return false;
    if (!q) return true;
    return nameMatchesQuery(name, q);
  });
  return matched.slice(0, 8);
}

export type MentionRun =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; name: string; userId: string | null };

export function splitMentionRuns(text: string): MentionRun[] {
  const source = String(text ?? '');
  const runs: MentionRun[] = [];
  let cursor = 0;
  const re = new RegExp(STRUCTURED_RE.source, 'g');
  for (const match of source.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > cursor) runs.push({ kind: 'text', text: source.slice(cursor, index) });
    runs.push({ kind: 'mention', name: String(match[1] ?? '').trim(), userId: match[2] ?? null });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) runs.push({ kind: 'text', text: source.slice(cursor) });
  return runs.length ? runs : [{ kind: 'text', text: source }];
}
