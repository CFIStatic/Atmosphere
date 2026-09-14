/**
 * Punch list / open items from job video analysis.
 *
 * Composition only — never invents work. Surfaces action items, unfinished
 * commitments, unresolved questions, in-progress scope verdicts, and visible
 * concerns already stored on proofs. Coverage gaps (not_visible / cannotTell)
 * stay out of the list.
 */

import { seekSecondsFor } from './disputeSurfacing.js';

export const JOB_PUNCH_LIST_SCHEMA = 'atmosphere.job_punch_list.v1' as const;

export type PunchListSource =
  | 'action'
  | 'commitment'
  | 'unresolved'
  | 'scope_in_progress'
  | 'concern';

export type PunchListItem = {
  id: string;
  fingerprint: string;
  text: string;
  detail: string | null;
  quote: string | null;
  ownerLabel: string | null;
  source: PunchListSource;
  seekSeconds: number | null;
  proofId: string | null;
  workDate: string | null;
  company: string | null;
  partyId: string | null;
  phase: string | null;
  scopeTitle: string | null;
  /** Set when a matching job_task already exists for this fingerprint. */
  assignedTaskId: string | null;
};

export type PunchListFact = {
  text?: string | null;
  tSec?: number | null;
  atSeconds?: number | null;
  seekSeconds?: number | null;
  quote?: string | null;
  owner?: string | null;
  kind?: string | null;
};

export type PunchListClipInput = {
  id: string;
  partyId?: string | null;
  company?: string | null;
  workDate: string;
  phase?: string | null;
  conversation?: {
    conversationActionItems?: PunchListFact[];
    conversationCommitments?: PunchListFact[];
    conversationUnresolvedQuestions?: PunchListFact[];
    actionItems?: PunchListFact[];
    commitments?: PunchListFact[];
    unresolvedQuestions?: PunchListFact[];
  } | null;
  aiFindings?: {
    scopeVerdicts?: Array<{ title?: string; verdict?: string; because?: string | null }>;
    concerns?: string[];
  } | null;
  events?: Array<{ atSeconds: number; text: string }>;
};

export type PunchListAssignedTask = {
  id: string;
  title?: string | null;
  details?: string | null;
  status?: string | null;
};

function clean(value: unknown, max = 400): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return trimmed || null;
}

function normKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function punchFingerprint(input: {
  proofId: string | null;
  source: PunchListSource;
  text: string;
  scopeTitle?: string | null;
}): string {
  const parts = [
    input.proofId ?? '',
    input.source,
    normKey(input.scopeTitle || input.text),
  ];
  return parts.join('|');
}

/** Machine line stored in job_tasks.details so Assign can round-trip. */
export const PUNCH_TASK_MARKER = 'atmosphere.punch:';

export function punchMarkerLine(fingerprint: string, seekSeconds: number | null, proofId: string | null): string {
  const seek = seekSeconds == null || !Number.isFinite(seekSeconds) ? '' : String(Math.round(seekSeconds));
  return `${PUNCH_TASK_MARKER}${fingerprint};seek=${seek};proof=${proofId ?? ''}`;
}

export function fingerprintFromTaskDetails(details: string | null | undefined): string | null {
  if (!details) return null;
  const line = details.split('\n').find((l) => l.trimStart().startsWith(PUNCH_TASK_MARKER));
  if (!line) return null;
  const body = line.trim().slice(PUNCH_TASK_MARKER.length);
  const fingerprint = body.split(';')[0]?.trim();
  return fingerprint || null;
}

function factText(fact: PunchListFact): string | null {
  return clean(fact.text, 280);
}

function factSeek(fact: PunchListFact, events: Array<{ atSeconds: number; text: string }>, needle: string): number | null {
  const raw = fact.tSec ?? fact.atSeconds ?? fact.seekSeconds;
  if (raw != null && Number.isFinite(Number(raw)) && Number(raw) >= 0) {
    return Number(raw);
  }
  return seekSecondsFor(events, needle);
}

function pushItem(
  out: PunchListItem[],
  seen: Set<string>,
  item: Omit<PunchListItem, 'id' | 'fingerprint' | 'assignedTaskId'> & { fingerprint?: string },
) {
  const text = clean(item.text, 280);
  if (!text) return;
  const fingerprint =
    item.fingerprint ??
    punchFingerprint({
      proofId: item.proofId,
      source: item.source,
      text,
      scopeTitle: item.scopeTitle,
    });
  if (seen.has(fingerprint)) return;
  seen.add(fingerprint);
  out.push({
    ...item,
    text,
    detail: clean(item.detail, 600),
    quote: clean(item.quote, 400),
    ownerLabel: clean(item.ownerLabel, 80),
    fingerprint,
    id: fingerprint,
    assignedTaskId: null,
  });
}

function factsFromConversation(
  conversation: PunchListClipInput['conversation'],
  key: 'actionItems' | 'commitments' | 'unresolvedQuestions',
): PunchListFact[] {
  if (!conversation) return [];
  const publicKey =
    key === 'actionItems'
      ? 'conversationActionItems'
      : key === 'commitments'
        ? 'conversationCommitments'
        : 'conversationUnresolvedQuestions';
  const rich = (conversation as Record<string, unknown>)[publicKey];
  const stored = (conversation as Record<string, unknown>)[key];
  const list = Array.isArray(rich) && rich.length ? rich : Array.isArray(stored) ? stored : [];
  return list.filter((f) => f && typeof f === 'object') as PunchListFact[];
}

/**
 * Build open punch-list items from clip analysis already on file.
 * Never invents items — empty / missing analysis → empty list.
 */
export function buildJobPunchList(input: {
  clips: PunchListClipInput[];
  assignedTasks?: PunchListAssignedTask[];
}): PunchListItem[] {
  const out: PunchListItem[] = [];
  const seen = new Set<string>();

  for (const clip of input.clips) {
    const events = (clip.events ?? [])
      .filter((e) => Number.isFinite(e.atSeconds) && String(e.text || '').trim())
      .map((e) => ({ atSeconds: Number(e.atSeconds), text: String(e.text).trim() }));
    const base = {
      proofId: clip.id,
      workDate: clip.workDate || null,
      company: clean(clip.company, 120),
      partyId: clip.partyId ?? null,
      phase: clip.phase ? String(clip.phase) : null,
    };

    for (const fact of factsFromConversation(clip.conversation, 'actionItems')) {
      const text = factText(fact);
      if (!text) continue;
      pushItem(out, seen, {
        ...base,
        text,
        detail: null,
        quote: clean(fact.quote, 400),
        ownerLabel: clean(fact.owner, 80),
        source: 'action',
        seekSeconds: factSeek(fact, events, text),
        scopeTitle: null,
      });
    }

    for (const fact of factsFromConversation(clip.conversation, 'commitments')) {
      const text = factText(fact);
      if (!text) continue;
      // Commitments are open follow-ups when phrased as unfinished work.
      pushItem(out, seen, {
        ...base,
        text,
        detail: 'Commitment from on-site conversation',
        quote: clean(fact.quote, 400),
        ownerLabel: clean(fact.owner, 80),
        source: 'commitment',
        seekSeconds: factSeek(fact, events, text),
        scopeTitle: null,
      });
    }

    for (const fact of factsFromConversation(clip.conversation, 'unresolvedQuestions')) {
      const text = factText(fact);
      if (!text) continue;
      pushItem(out, seen, {
        ...base,
        text,
        detail: 'Unresolved on mic',
        quote: clean(fact.quote, 400),
        ownerLabel: clean(fact.owner, 80),
        source: 'unresolved',
        seekSeconds: factSeek(fact, events, text),
        scopeTitle: null,
      });
    }

    const findings = clip.aiFindings && typeof clip.aiFindings === 'object' ? clip.aiFindings : null;
    for (const verdict of findings?.scopeVerdicts ?? []) {
      if (String(verdict?.verdict || '') !== 'in_progress') continue;
      const title = clean(verdict?.title, 200);
      if (!title) continue;
      const because = clean(verdict?.because, 400);
      pushItem(out, seen, {
        ...base,
        text: title,
        detail: because ? `In progress on film — ${because}` : 'In progress on film',
        quote: null,
        ownerLabel: null,
        source: 'scope_in_progress',
        seekSeconds: seekSecondsFor(events, title),
        scopeTitle: title,
      });
    }

    for (const concern of findings?.concerns ?? []) {
      const text = clean(concern, 280);
      if (!text) continue;
      pushItem(out, seen, {
        ...base,
        text,
        detail: 'Visible concern on film',
        quote: null,
        ownerLabel: null,
        source: 'concern',
        seekSeconds: seekSecondsFor(events, text),
        scopeTitle: null,
      });
    }
  }

  // Prefer actionable sources first, then by work date / seek.
  const rank: Record<PunchListSource, number> = {
    action: 0,
    commitment: 1,
    scope_in_progress: 2,
    concern: 3,
    unresolved: 4,
  };
  out.sort((a, b) => {
    const r = rank[a.source] - rank[b.source];
    if (r !== 0) return r;
    const da = a.workDate || '';
    const db = b.workDate || '';
    if (da !== db) return db.localeCompare(da);
    return (a.seekSeconds ?? 1e9) - (b.seekSeconds ?? 1e9);
  });

  const assignedByFp = new Map<string, string>();
  for (const task of input.assignedTasks ?? []) {
    if (!task?.id) continue;
    const status = String(task.status || '').toLowerCase();
    if (status === 'done' || status === 'cancelled') continue;
    const fp =
      fingerprintFromTaskDetails(task.details) ||
      (task.title ? punchFingerprint({ proofId: null, source: 'action', text: task.title }) : null);
    if (fp && !assignedByFp.has(fp)) assignedByFp.set(fp, task.id);
  }

  for (const item of out) {
    item.assignedTaskId = assignedByFp.get(item.fingerprint) ?? null;
    // Also match when task was created with proof-scoped fingerprint.
    if (!item.assignedTaskId && item.proofId) {
      for (const [fp, taskId] of assignedByFp) {
        if (fp.endsWith(`|${normKey(item.scopeTitle || item.text)}`) || fp === item.fingerprint) {
          item.assignedTaskId = taskId;
          break;
        }
      }
    }
  }

  return out.slice(0, 80);
}

export function taskPayloadFromPunchItem(item: PunchListItem): {
  title: string;
  details: string;
  priority: 'normal' | 'high';
} {
  const clock =
    item.seekSeconds != null && Number.isFinite(item.seekSeconds)
      ? ` @ ${formatPunchClock(item.seekSeconds)}`
      : '';
  const where = [item.workDate, item.company, item.phase].filter(Boolean).join(' · ');
  const lines = [
    item.detail,
    item.quote ? `Exact: “${item.quote}”` : null,
    where ? `From film: ${where}${clock}` : clock ? `From film${clock}` : null,
    item.ownerLabel ? `Suggested owner (from talk): ${item.ownerLabel}` : null,
    punchMarkerLine(item.fingerprint, item.seekSeconds, item.proofId),
  ].filter(Boolean);
  return {
    title: item.text.slice(0, 200),
    details: lines.join('\n'),
    priority: item.source === 'concern' || item.source === 'scope_in_progress' ? 'high' : 'normal',
  };
}

export function formatPunchClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const n = Math.max(0, Math.floor(seconds));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
