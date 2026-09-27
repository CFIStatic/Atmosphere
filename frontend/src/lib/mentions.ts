/**
 * Client side of @mentions. The server re-resolves every handle against the
 * caller's org, so this only inserts a token and paints chips.
 */

export interface MentionMember {
  userId: string;
  handle: string;
  fullName: string | null;
  email: string | null;
}

const HANDLE_RE = /^[a-z0-9][a-z0-9_]{1,31}$/;
const STRUCTURED_RE = /@\[([A-Za-z0-9][A-Za-z0-9_]{1,31})\]\(mention:([A-Za-z0-9_-]{1,64})\)/g;

export function normalizeHandle(raw: unknown): string | null {
  const compact = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!HANDLE_RE.test(compact)) return null;
  return compact;
}

export function handleBase(input: {
  handle?: string | null;
  fullName?: string | null;
  email?: string | null;
}): string {
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

export function assignOrgHandles<
  T extends { userId: string; handle?: string | null; fullName?: string | null; email?: string | null },
>(members: T[]): Array<T & { handle: string }> {
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
    const base = handleBase({ fullName: member.fullName, email: member.email, handle: null });
    let n = 1;
    let handle = n === 1 ? base.slice(0, 32) : `${base.slice(0, 31)}${n}`;
    while (used.has(handle)) {
      n += 1;
      const suffix = String(n);
      handle = `${base.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
    }
    used.add(handle);
    assigned.set(member.userId, handle);
  }
  return members.map((member) => ({ ...member, handle: assigned.get(member.userId) ?? 'member' }));
}

export function mentionToken(handle: string, userId: string): string {
  return `@[${handle}](mention:${userId})`;
}

/** Replace bare @handles with tokens that carry the org member's id. */
export function expandMentionTokens(text: string, members: MentionMember[]): string {
  const byHandle = new Map(members.map((member) => [member.handle, member]));
  return text.replace(
    /(^|[\s(])@([A-Za-z0-9][A-Za-z0-9_]{1,31})\b/g,
    (full, lead: string, handle: string, offset: number) => {
      const prior = text.slice(0, offset);
      if (/@\[[A-Za-z0-9_]+\]\(mention:[0-9a-fA-F-]{0,36}$/.test(prior + full)) return full;
      const member = byHandle.get(handle.toLowerCase());
      if (!member) return full;
      return `${lead}${mentionToken(member.handle, member.userId)}`;
    },
  );
}

export function mentionQueryAt(
  text: string,
  cursor: number,
): { start: number; end: number; query: string } | null {
  const upto = text.slice(0, cursor);
  const match = upto.match(/(^|[\s(])@([A-Za-z0-9_]{0,32})$/);
  if (!match) return null;
  const query = match[2] ?? '';
  const start = upto.length - query.length - 1;
  return { start, end: cursor, query };
}

export function filterMentionMembers(members: MentionMember[], query: string): MentionMember[] {
  const q = query.trim().toLowerCase();
  const matched = members.filter((member) => {
    if (!q) return true;
    const handle = member.handle.toLowerCase();
    const name = (member.fullName ?? '').toLowerCase();
    const email = (member.email ?? '').toLowerCase();
    const local = email.split('@')[0] ?? '';
    return (
      handle.startsWith(q) ||
      handle.includes(q) ||
      name.startsWith(q) ||
      name.split(/\s+/).some((part) => part.startsWith(q)) ||
      local.startsWith(q)
    );
  });
  return matched.slice(0, 8);
}

export type MentionRun = { kind: 'text'; text: string } | { kind: 'mention'; handle: string; userId: string | null };

export function splitMentionRuns(text: string): MentionRun[] {
  const source = String(text ?? '');
  const runs: MentionRun[] = [];
  let cursor = 0;
  const re = new RegExp(STRUCTURED_RE.source, 'g');
  for (const match of source.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > cursor) runs.push({ kind: 'text', text: source.slice(cursor, index) });
    runs.push({ kind: 'mention', handle: match[1].toLowerCase(), userId: match[2] });
    cursor = index + match[0].length;
  }
  if (cursor < source.length) runs.push({ kind: 'text', text: source.slice(cursor) });
  return runs.length ? runs : [{ kind: 'text', text: source }];
}
