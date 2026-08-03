/**
 * The rules of a shared job record.
 *
 * A general contractor and a subcontractor lose money in a narrow set of ways,
 * and every one of them is the same failure: the two sides were working from
 * different facts. This file is the arithmetic of catching that before the
 * crew is already on site doing something nobody agreed to.
 *
 * Pure on purpose. Every judgement below is one somebody will eventually argue
 * with — "you never told us", "that was approved" — and a rule that can only be
 * checked by standing up a database is a rule nobody checks.
 *
 * The bias throughout is towards raising a flag that turns out to be nothing,
 * over staying quiet about something real. A false alarm costs a phone call. A
 * missed one costs a demolished wall.
 */

export type ScopeState = 'included' | 'excluded' | 'proposed' | 'approved' | 'declined';

export interface ScopeItem {
  id: string;
  state: ScopeState;
  title: string;
  detail?: string | null;
  amount?: number | null;
  reason?: string | null;
  revision: number;
  party_id?: string | null;
  decided_at?: string | null;
  created_at: string;
}

export interface Party {
  id: string;
  company: string;
  trade?: string | null;
  role: string;
  invited_at?: string | null;
  last_seen_at?: string | null;
  revoked_at?: string | null;
}

export interface Acknowledgement {
  party_id: string;
  revision: number;
  acknowledged_at: string;
}

export type RiskLevel = 'blocker' | 'warn' | 'note';

export interface Risk {
  key: string;
  level: RiskLevel;
  title: string;
  /** What to do about it. A risk without this is an observation. */
  action: string;
  partyId?: string | null;
  scopeItemId?: string | null;
}

/** Whole hours since a timestamp, or null if it is unusable. */
function hoursSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return (now.getTime() - at) / 3_600_000;
}

/**
 * Everything wrong with this job record right now.
 *
 * Ordered by what it costs to be wrong about, not by recency. A sub working
 * from a superseded scope outranks an unanswered question, because one of them
 * is a wall coming down and the other is a phone call not yet returned.
 */
export function assessJob(input: {
  parties: Party[];
  scope: ScopeItem[];
  acknowledgements: Acknowledgement[];
  currentRevision: number | null;
  /** Whether the job is being worked right now. Changes what is urgent. */
  onSite?: boolean;
  now?: Date;
}): Risk[] {
  const now = input.now ?? new Date();
  const risks: Risk[] = [];
  const active = input.parties.filter((p) => !p.revoked_at);

  const ackByParty = new Map<string, number>();
  for (const ack of input.acknowledgements) {
    const best = ackByParty.get(ack.party_id) ?? 0;
    if (ack.revision > best) ackByParty.set(ack.party_id, ack.revision);
  }

  // 1. Somebody is working from facts that have been superseded. This is the
  //    one that produces the wall coming down.
  if (input.currentRevision !== null) {
    for (const party of active) {
      if (party.role === 'general_contractor') continue;
      const acked = ackByParty.get(party.id);
      if (acked === undefined) {
        risks.push({
          key: `unacked:${party.id}`,
          level: party.invited_at ? 'blocker' : 'warn',
          title: `${party.company} has not accepted the scope`,
          action: party.invited_at
            ? 'They have the link and have not confirmed. Do not let them start.'
            : 'Send them the link before they mobilise.',
          partyId: party.id,
        });
      } else if (acked < input.currentRevision) {
        risks.push({
          key: `stale:${party.id}`,
          level: 'blocker',
          title: `${party.company} accepted revision ${acked}; the job is on ${input.currentRevision}`,
          action: 'They are working from a superseded scope. Get the new one accepted before more work happens.',
          partyId: party.id,
        });
      }
    }
  }

  // 2. Work waiting on an answer. The sub is standing there; the cost of the
  //    delay is real and lands on somebody.
  for (const item of input.scope) {
    if (item.state !== 'proposed') continue;
    const waiting = hoursSince(item.created_at, now) ?? 0;
    risks.push({
      key: `proposed:${item.id}`,
      // A day is the point at which a crew either goes home or does it anyway,
      // and doing it anyway is the outcome this whole record exists to prevent.
      level: waiting >= 24 ? 'blocker' : 'warn',
      title: `Waiting on your answer: ${item.title}`,
      action:
        waiting >= 24
          ? `Asked ${Math.round(waiting / 24)} day${Math.round(waiting / 24) === 1 ? '' : 's'} ago. Answer it or it gets decided on site.`
          : 'Approve with a number, or decline and say why.',
      scopeItemId: item.id,
    });
  }

  // 3. An approved line with no price. The work is authorised and the number is
  //    not agreed, which is the shape of every backcharge argument.
  for (const item of input.scope) {
    if (item.state !== 'approved') continue;
    if (item.amount !== null && item.amount !== undefined) continue;
    risks.push({
      key: `unpriced:${item.id}`,
      level: 'warn',
      title: `Approved with no amount: ${item.title}`,
      action: 'Put a number on it now. Agreeing the price after the work is a negotiation.',
      scopeItemId: item.id,
    });
  }

  // 4. An exclusion with no reason. "Not in scope" does not stop the helpful
  //    sub who does it anyway; "the owner is handling flooring" does.
  for (const item of input.scope) {
    if (item.state !== 'excluded') continue;
    if (item.reason && item.reason.trim().length > 0) continue;
    risks.push({
      key: `bare-exclusion:${item.id}`,
      level: 'note',
      title: `No reason given for excluding: ${item.title}`,
      action: 'Say why. An exclusion nobody understands is one somebody works around.',
      scopeItemId: item.id,
    });
  }

  // 5. Nothing is excluded at all. A scope list that only says what to do
  //    leaves "and nothing else" to be inferred, and it never is.
  if (input.scope.length > 0 && !input.scope.some((i) => i.state === 'excluded')) {
    risks.push({
      key: 'no-exclusions',
      level: 'note',
      title: 'Nothing is marked out of scope',
      action:
        'Write down what this crew must not touch. The expensive line is always the one somebody assumed was included.',
    });
  }

  // 6. Invited and never opened it. The link went to a spam folder and
  //    everybody believes the other side is informed.
  for (const party of active) {
    if (!party.invited_at || party.last_seen_at) continue;
    const waiting = hoursSince(party.invited_at, now) ?? 0;
    if (waiting < 48) continue;
    risks.push({
      key: `never-opened:${party.id}`,
      level: 'warn',
      title: `${party.company} has never opened the job record`,
      action: `Invited ${Math.round(waiting / 24)} days ago and never viewed. Assume they have not seen any of it.`,
      partyId: party.id,
    });
  }

  const order: Record<RiskLevel, number> = { blocker: 0, warn: 1, note: 2 };
  return risks.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * Is this party clear to work?
 *
 * The question the dashboard is really answering, and the reason it is one
 * sentence rather than a status field: "yes" has to mean they have accepted
 * the current facts and nothing of theirs is waiting on an answer. Anything
 * less is a qualified yes, and a qualified yes read at speed becomes a yes.
 */
export function clearToWork(input: {
  party: Party;
  scope: ScopeItem[];
  acknowledgedRevision: number | null;
  currentRevision: number | null;
}): { clear: boolean; because: string } {
  if (input.party.revoked_at) {
    return { clear: false, because: 'Access to this job was revoked.' };
  }
  if (input.currentRevision === null) {
    return { clear: false, because: 'No scope has been published yet.' };
  }
  if (input.acknowledgedRevision === null) {
    return { clear: false, because: 'They have not accepted the scope.' };
  }
  if (input.acknowledgedRevision < input.currentRevision) {
    return {
      clear: false,
      because: `They accepted revision ${input.acknowledgedRevision}; the job is on ${input.currentRevision}.`,
    };
  }

  const waiting = input.scope.filter(
    (i) => i.state === 'proposed' && (!i.party_id || i.party_id === input.party.id),
  );
  if (waiting.length) {
    return {
      clear: false,
      because: `${waiting.length} item${waiting.length === 1 ? '' : 's'} waiting on an answer.`,
    };
  }

  return { clear: true, because: `Accepted revision ${input.currentRevision}. Nothing outstanding.` };
}

/**
 * What this party is allowed to do, in the order they need it.
 *
 * Exclusions first. Every other tool in this category buries the do-not list
 * below the do list, which is exactly backwards: somebody reading on a phone in
 * a truck reads the top of the screen and starts working.
 */
export function scopeForParty(scope: ScopeItem[], partyId: string): ScopeItem[] {
  const mine = scope.filter((i) => !i.party_id || i.party_id === partyId);
  const rank: Record<ScopeState, number> = {
    excluded: 0,
    proposed: 1,
    included: 2,
    approved: 3,
    declined: 4,
  };
  return [...mine].sort(
    (a, b) => rank[a.state] - rank[b.state] || a.created_at.localeCompare(b.created_at),
  );
}

/** What the job has been authorised to cost, and what is still unpriced. */
export function scopeMoney(scope: ScopeItem[]): {
  approved: number;
  pending: number;
  unpricedApprovals: number;
} {
  let approved = 0;
  let pending = 0;
  let unpricedApprovals = 0;
  for (const item of scope) {
    if (item.state === 'approved') {
      if (item.amount === null || item.amount === undefined) unpricedApprovals += 1;
      else approved += Number(item.amount);
    }
    if (item.state === 'proposed' && item.amount !== null && item.amount !== undefined) {
      pending += Number(item.amount);
    }
  }
  return { approved, pending, unpricedApprovals };
}
