/**
 * Account structure: the arithmetic of trees, links and merges.
 *
 * Pure, because the two operations here are the ones that ruin a customer's
 * data rather than inconvenience it. A reparent that creates a cycle hangs
 * every rollup on the page. A merge points hundreds of jobs, contacts and
 * campaign members at a different company and cannot be undone in one click.
 * Neither should be reasoned about only by running it.
 *
 * The database refuses cycles too. This exists so the refusal arrives as a
 * sentence before somebody presses the button, rather than as a constraint
 * violation afterwards — and so the same rule can be checked in a test without
 * a database.
 */

export interface AccountNode {
  id: string;
  name: string;
  parentAccountId: string | null;
  type?: string | null;
  mergedIntoId?: string | null;
}

/** The chain from an account up to its root, nearest first. */
export function ancestorsOf(id: string, accounts: AccountNode[]): AccountNode[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: AccountNode[] = [];
  const seen = new Set<string>([id]);

  let cursor = byId.get(id)?.parentAccountId ?? null;
  while (cursor) {
    // Defensive against data that predates the cycle guard: stop rather than
    // spin. A page that hangs is worse than a breadcrumb that is short.
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    out.push(node);
    cursor = node.parentAccountId;
  }
  return out;
}

/** Everything under an account, including itself. */
export function subtreeOf(id: string, accounts: AccountNode[]): AccountNode[] {
  const children = new Map<string, AccountNode[]>();
  for (const account of accounts) {
    if (!account.parentAccountId) continue;
    const list = children.get(account.parentAccountId) ?? [];
    list.push(account);
    children.set(account.parentAccountId, list);
  }

  const root = accounts.find((a) => a.id === id);
  if (!root) return [];

  const out: AccountNode[] = [root];
  const queue = [id];
  const seen = new Set<string>([id]);
  while (queue.length) {
    const next = queue.shift()!;
    for (const child of children.get(next) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

/**
 * May this account be given that parent?
 *
 * Returns the reason it may not, or null. Phrased as a sentence because it goes
 * straight to somebody who is about to do it, and "constraint violation" is not
 * an explanation of anything.
 */
export function reparentProblem(
  childId: string,
  parentId: string | null,
  accounts: AccountNode[],
): string | null {
  if (!parentId) return null;
  if (childId === parentId) return 'An account cannot be its own parent.';

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const child = byId.get(childId);
  const parent = byId.get(parentId);
  if (!child) return 'That account no longer exists.';
  if (!parent) return 'That parent account no longer exists.';

  // A tombstone has no place in a live tree: everything under it would vanish
  // from every view that excludes merged accounts.
  if (parent.mergedIntoId) {
    return `${parent.name} was merged into another account and cannot be a parent.`;
  }

  // The check that matters. Putting a company under one of its own descendants
  // makes a loop, and a loop hangs every rollup and breadcrumb on the page.
  const descendants = subtreeOf(childId, accounts);
  if (descendants.some((d) => d.id === parentId)) {
    return `${parent.name} already sits under ${child.name}. That would make a loop.`;
  }

  const depth = ancestorsOf(parentId, accounts).length + 1;
  if (depth >= 20) {
    return 'That is twenty levels deep, which is deeper than any real company structure.';
  }

  return null;
}

/** What a merge would move, so the size of it is visible beforehand. */
export interface MergeImpact {
  contacts: number;
  jobs: number;
  leads: number;
  properties: number;
  childAccounts: number;
  links: number;
}

/**
 * Is this merge allowed, and is it the one they meant?
 *
 * Deliberately strict about direction. Merging a parent into its own child
 * inverts a hierarchy somebody built on purpose, and it is almost always a
 * misclick — the two rows look identical in a duplicate list.
 */
export function mergeProblem(
  winnerId: string,
  loserId: string,
  accounts: AccountNode[],
): string | null {
  if (winnerId === loserId) return 'That is the same account twice.';

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const winner = byId.get(winnerId);
  const loser = byId.get(loserId);
  if (!winner) return 'The account to keep no longer exists.';
  if (!loser) return 'The account to merge no longer exists.';

  if (loser.mergedIntoId) {
    return `${loser.name} has already been merged.`;
  }
  if (winner.mergedIntoId) {
    // Merging into a tombstone would daisy-chain redirects and eventually
    // resolve nowhere.
    return `${winner.name} has itself been merged into another account. Merge into that one instead.`;
  }

  const winnerAncestors = ancestorsOf(winnerId, accounts).map((a) => a.id);
  if (winnerAncestors.includes(loserId)) {
    return `${loser.name} is above ${winner.name} in the hierarchy. Merging it away would invert the structure — check which one you meant to keep.`;
  }

  return null;
}

/**
 * Pick the survivor when two records describe the same company.
 *
 * Not a guess at which is "better" — a proposal, on the one signal that
 * actually correlates with which record people have been using: the one with
 * more attached to it. A tie goes to the older record, because that is the one
 * whose id is in everybody's exports and bookmarks.
 */
export function suggestWinner(
  a: { id: string; createdAt: string; attached: number },
  b: { id: string; createdAt: string; attached: number },
): string {
  if (a.attached !== b.attached) return a.attached > b.attached ? a.id : b.id;
  return Date.parse(a.createdAt) <= Date.parse(b.createdAt) ? a.id : b.id;
}

/**
 * How alike are two company names?
 *
 * Deliberately crude, and deliberately used only to *suggest*. "Cedar Ridge
 * HOA" and "Cedar Ridge H.O.A." are the same customer; "Cedar Ridge HOA" and
 * "Cedar Grove HOA" are two streets apart and two different customers. No
 * automatic merge runs off this — it orders a list a person then reads.
 */
export function nameSimilarity(a: string, b: string): number {
  const clean = (s: string) =>
    s
      .toLowerCase()
      // Punctuation is the whole difference in "H.O.A." vs "HOA".
      .replace(/[^a-z0-9\s]/g, '')
      // Suffixes that say nothing about identity. "Inc" is not a distinguishing
      // feature; two "Cedar Ridge" companies are the same one.
      .replace(/\b(inc|llc|ltd|corp|co|company|the|and)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const x = clean(a);
  const y = clean(b);
  if (!x || !y) return 0;
  if (x === y) return 1;

  const tokens = (s: string) => new Set(s.split(' ').filter((t) => t.length > 1));
  const tx = tokens(x);
  const ty = tokens(y);
  if (!tx.size || !ty.size) return 0;

  let shared = 0;
  for (const token of tx) if (ty.has(token)) shared += 1;
  // Jaccard: shared over the union. Punishes a long name matching a short one
  // on a single common word, which is exactly the false positive to avoid.
  return shared / (tx.size + ty.size - shared);
}

/**
 * Likely duplicates, ordered by how likely.
 *
 * Only pairs above the threshold, and never anything already merged. Returns
 * pairs rather than clusters: a person confirming "these two are the same" is a
 * decision they can actually make, where "these five are the same" is one they
 * will get wrong.
 */
export function findDuplicates(
  accounts: Array<AccountNode & { createdAt: string; attached: number }>,
  threshold = 0.6,
): Array<{ a: AccountNode; b: AccountNode; score: number; suggestedWinner: string }> {
  const live = accounts.filter((a) => !a.mergedIntoId);
  const out: Array<{ a: AccountNode; b: AccountNode; score: number; suggestedWinner: string }> = [];

  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const score = nameSimilarity(live[i].name, live[j].name);
      if (score < threshold) continue;
      out.push({
        a: live[i],
        b: live[j],
        score,
        suggestedWinner: suggestWinner(live[i], live[j]),
      });
    }
  }

  return out.sort((x, y) => y.score - x.score).slice(0, 50);
}

/** Which way round a link reads, from one side of it. */
export function describeLink(
  kind: string,
  direction: 'from' | 'to',
  otherName: string,
): string {
  const words: Record<string, [string, string]> = {
    insures: ['insures', 'is insured by'],
    manages: ['manages', 'is managed by'],
    owns: ['owns', 'is owned by'],
    subcontracts_to: ['subcontracts to', 'works as a sub for'],
    refers: ['refers work to', 'receives referrals from'],
    vendor_to: ['supplies', 'is supplied by'],
    related: ['is connected to', 'is connected to'],
  };
  const pair = words[kind] ?? words.related;
  return `${direction === 'from' ? pair[0] : pair[1]} ${otherName}`;
}
