/**
 * Load org-scoped evidence for people named with @mentions, then either
 * answer directly (nothing relevant, or no model) or hand a ranked dossier
 * to the existing Ask model call.
 */
import { isAskModelConfigured } from '../lib/askModel.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  ambiguitySentence,
  answerFromMentionContext,
  formatMentionPrompt,
  loginNameFromMetadata,
  mentionDisplayName,
  rankMentionItems,
  resolveMentions,
  textMentionsPerson,
  type MentionIdentity,
  type MentionItem,
  type MentionMember,
  type PersonMentionContext,
  type ResolvedMention,
} from './mentions.js';

type Db = {
  from: (table: string) => {
    select: (columns?: string) => any;
  };
};

async function selectRows(db: Db, table: string, apply: (query: any) => any): Promise<any[]> {
  try {
    const query = apply(db.from(table));
    const result = await query;
    if (result?.error) return [];
    return (result?.data ?? []) as any[];
  } catch {
    return [];
  }
}

function asProfile(row: any): { email: string | null; fullName: string | null } {
  const profile = Array.isArray(row?.profiles) ? row.profiles[0] : row?.profiles;
  return {
    email: profile?.email ?? null,
    fullName: profile?.full_name ?? null,
  };
}

/**
 * When the profile name is empty, use the name stored on the auth login
 * (Google/OAuth full_name, then name). No service role means those members
 * stay unnamed and cannot be @mentioned.
 */
export async function fillLoginNames<
  T extends { userId: string; fullName?: string | null; loginName?: string | null },
>(members: T[]): Promise<T[]> {
  const missing = members.filter((member) => !mentionDisplayName(member));
  if (!missing.length) return members;
  const admin = unscopedAdminOrNull();
  if (!admin) return members;
  const found = new Map<string, string>();
  await Promise.all(
    missing.map(async (member) => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(member.userId);
        if (error) return;
        const login = loginNameFromMetadata(data?.user?.user_metadata);
        if (login) found.set(member.userId, login);
      } catch {
        /* Auth admin is optional. */
      }
    }),
  );
  if (!found.size) return members;
  return members.map((member) => {
    const loginName = found.get(member.userId);
    if (!loginName) return member;
    return {
      ...member,
      loginName,
      fullName: mentionDisplayName({ fullName: member.fullName, loginName }),
    };
  });
}

/** Members of one org. RLS on `db` is the real boundary. */
export async function listOrgMentionMembers(db: Db, orgId: string): Promise<MentionMember[]> {
  const withHandle = await selectRows(db, 'org_members', (query) =>
    query
      .select('user_id, status, profiles(email, full_name, handle)')
      .eq('org_id', orgId),
  );
  const rows = withHandle.length
    ? withHandle
    : await selectRows(db, 'org_members', (query) =>
        query.select('user_id, status, profiles(email, full_name)').eq('org_id', orgId),
      );

  const active = rows.filter((row) => !row.status || row.status === 'active');
  const identities: MentionIdentity[] = [];
  for (const row of active) {
    const profile = asProfile(row);
    const userId = String(row.user_id ?? '');
    if (!userId) continue;
    identities.push({
      userId,
      email: profile.email,
      fullName: profile.fullName,
    });
  }
  return fillLoginNames(identities);
}

function clipText(row: any): string {
  return [row.ai_summary, row.narration_text, row.transcript_text]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 1200);
}

function proofCapturedBy(
  proof: any,
  userId: string,
  parties: Map<string, any>,
  uploads: Set<string>,
  acks: Set<string>,
): boolean {
  const party = parties.get(String(proof.party_id ?? ''));
  if (party?.created_by === userId) return true;
  if (uploads.has(`${userId}:${proof.id}`)) return true;
  if (acks.has(`${userId}:${proof.job_id}:${proof.work_date}`)) return true;
  return false;
}

export async function loadPersonContext(
  db: Db,
  input: {
    orgId: string;
    people: ResolvedMention[];
    question: string;
    now?: Date;
    roster?: MentionMember[];
  },
): Promise<PersonMentionContext[]> {
  const { orgId, people } = input;
  if (!people.length) return [];
  const roster: MentionMember[] =
    input.roster ?? people.map((person) => ({ userId: person.userId, fullName: person.name }));
  const userIds = people.map((person) => person.userId);
  const now = input.now ?? new Date();

  const [assignments, ownedJobs, createdJobs, tasks, uploads, acks, logs, mentionRows] = await Promise.all([
    selectRows(db, 'job_assignments', (query) =>
      query.select('job_id, user_id, role_on_job, assigned_at, released_at').eq('org_id', orgId).in('user_id', userIds),
    ),
    selectRows(db, 'crm_jobs', (query) =>
      query
        .select('id, job_number, title, status, work_type, owner_id, created_by, updated_at')
        .eq('org_id', orgId)
        .in('owner_id', userIds),
    ),
    selectRows(db, 'crm_jobs', (query) =>
      query
        .select('id, job_number, title, status, work_type, owner_id, created_by, updated_at')
        .eq('org_id', orgId)
        .in('created_by', userIds),
    ),
    selectRows(db, 'job_tasks', (query) =>
      query
        .select('id, job_id, title, status, details, assigned_to, updated_at, completed_at')
        .eq('org_id', orgId)
        .in('assigned_to', userIds),
    ),
    selectRows(db, 'job_evidence_access', (query) =>
      query
        .select('proof_id, job_id, actor_id, action, occurred_at')
        .eq('org_id', orgId)
        .eq('action', 'uploaded')
        .in('actor_id', userIds),
    ),
    selectRows(db, 'recording_acknowledgments', (query) =>
      query.select('job_id, actor_user_id, work_date').eq('org_id', orgId).in('actor_user_id', userIds),
    ),
    selectRows(db, 'work_logs', (query) =>
      query
        .select('id, job_id, author_id, body, kind, occurred_at')
        .eq('org_id', orgId)
        .in('author_id', userIds)
        .order('occurred_at', { ascending: false })
        .limit(40),
    ),
    selectRows(db, 'content_mentions', (query) =>
      query
        .select('mentioned_user_id, source, source_id, job_id, handle, created_at')
        .eq('org_id', orgId)
        .in('mentioned_user_id', userIds)
        .order('created_at', { ascending: false })
        .limit(80),
    ),
  ]);

  const liveAssignments = assignments.filter((row) => !row.released_at);
  const assignedJobIds = [...new Set(liveAssignments.map((row) => String(row.job_id)).filter(Boolean))];
  const jobIds = [
    ...new Set(
      [
        ...assignedJobIds,
        ...ownedJobs.map((row) => String(row.id)),
        ...createdJobs.map((row) => String(row.id)),
        ...tasks.map((row) => String(row.job_id)),
        ...mentionRows.map((row) => String(row.job_id ?? '')),
      ].filter(Boolean),
    ),
  ];

  const taggedNoteIds = [
    ...new Set(
      mentionRows
        .filter((row) => row.source === 'job_message' && row.source_id)
        .map((row) => String(row.source_id)),
    ),
  ];

  const [jobs, proofs, parties, recentMessages, taggedNotes] = await Promise.all([
    jobIds.length
      ? selectRows(db, 'crm_jobs', (query) =>
          query
            .select('id, job_number, title, status, work_type, owner_id, created_by, updated_at')
            .eq('org_id', orgId)
            .in('id', jobIds),
        )
      : Promise.resolve([] as any[]),
    jobIds.length
      ? selectRows(db, 'job_proofs', (query) =>
          query
            .select(
              'id, job_id, party_id, work_date, phase, state, title, ai_summary, transcript_text, narration_text, captured_at, received_at',
            )
            .eq('org_id', orgId)
            .in('job_id', jobIds)
            .is('deleted_at', null)
            .order('work_date', { ascending: false })
            .limit(60),
        )
      : Promise.resolve([] as any[]),
    jobIds.length
      ? selectRows(db, 'job_parties', (query) =>
          query.select('id, job_id, created_by, company, trade').eq('org_id', orgId).in('job_id', jobIds),
        )
      : Promise.resolve([] as any[]),
    selectRows(db, 'job_messages', (query) =>
      query
        .select('id, job_id, author_id, author_label, body, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(120),
    ),
    taggedNoteIds.length
      ? selectRows(db, 'job_messages', (query) =>
          query
            .select('id, job_id, author_id, author_label, body, created_at')
            .eq('org_id', orgId)
            .in('id', taggedNoteIds),
        )
      : Promise.resolve([] as any[]),
  ]);
  const messages = [...taggedNotes, ...recentMessages];

  const taggedForUser = new Map<string, Set<string>>();
  for (const row of mentionRows) {
    const userId = String(row.mentioned_user_id ?? '');
    if (!userId) continue;
    const keys = taggedForUser.get(userId) ?? new Set<string>();
    keys.add(`${row.source}:${row.source_id}`);
    taggedForUser.set(userId, keys);
  }
  const partiesById = new Map(parties.map((row) => [String(row.id), row]));
  const uploadKeys = new Set(uploads.map((row) => `${row.actor_id}:${row.proof_id}`));
  const ackKeys = new Set(acks.map((row) => `${row.actor_user_id}:${row.job_id}:${row.work_date}`));
  const jobsById = new Map(jobs.map((row) => [String(row.id), row]));
  const assigned = new Set(liveAssignments.map((row) => `${row.user_id}:${row.job_id}`));

  return people.map((person) => {
    const items: MentionItem[] = [];
    const seen = new Set<string>();
    const push = (item: MentionItem) => {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };

    for (const job of jobs) {
      const id = String(job.id);
      const owns = job.owner_id === person.userId || job.created_by === person.userId;
      const onCrew = assigned.has(`${person.userId}:${id}`);
      if (!owns && !onCrew) continue;
      const title = [job.job_number ? `#${job.job_number}` : '', job.title].filter(Boolean).join(' ');
      push({
        kind: 'job',
        id,
        jobId: id,
        title: title || 'Job',
        text: [job.work_type, job.status].filter(Boolean).join(' · '),
        at: job.updated_at ?? null,
        status: job.status ?? null,
        captured: owns,
      });
    }

    for (const proof of proofs) {
      const jobId = String(proof.job_id ?? '');
      if (!jobsById.has(jobId) && !assigned.has(`${person.userId}:${jobId}`)) continue;
      const captured = proofCapturedBy(proof, person.userId, partiesById, uploadKeys, ackKeys);
      const onCrew = assigned.has(`${person.userId}:${jobId}`);
      const tagged = textMentionsPerson(clipText(proof), person.userId, roster);
      if (!captured && !onCrew && !tagged) continue;
      const job = jobsById.get(jobId);
      const title = String(proof.title || `${proof.phase ?? 'clip'} ${proof.work_date ?? ''}`.trim());
      push({
        kind: 'video',
        id: String(proof.id),
        jobId,
        proofId: String(proof.id),
        title: job?.title ? `${title} — ${job.title}` : title,
        text: clipText(proof),
        at: proof.captured_at ?? proof.received_at ?? proof.work_date ?? null,
        status: proof.state ?? null,
        captured,
        workDate: proof.work_date ?? null,
      });
    }

    for (const task of tasks) {
      if (task.assigned_to !== person.userId) continue;
      push({
        kind: 'task',
        id: String(task.id),
        jobId: task.job_id ?? null,
        title: String(task.title ?? 'Task'),
        text: String(task.details ?? ''),
        at: task.completed_at ?? task.updated_at ?? null,
        status: task.status ?? null,
        captured: true,
      });
    }

    for (const message of messages) {
      const body = String(message.body ?? '');
      const tagged =
        textMentionsPerson(body, person.userId, roster) ||
        Boolean(taggedForUser.get(person.userId)?.has(`job_message:${message.id}`));
      if (!tagged) continue;
      push({
        kind: 'note',
        id: String(message.id),
        jobId: message.job_id ?? null,
        title: String(message.author_label ?? 'Note'),
        text: body,
        at: message.created_at ?? null,
        captured: false,
      });
    }

    for (const log of logs) {
      if (log.author_id !== person.userId && !textMentionsPerson(String(log.body ?? ''), person.userId, roster)) continue;
      push({
        kind: 'log',
        id: String(log.id),
        jobId: log.job_id ?? null,
        title: String(log.kind ?? 'Log'),
        text: String(log.body ?? ''),
        at: log.occurred_at ?? null,
        captured: log.author_id === person.userId,
      });
    }

    const ranked = rankMentionItems(items, input.question, now).slice(0, 8);
    return {
      userId: person.userId,
      handle: person.handle,
      name: person.name,
      items: ranked,
    };
  });
}

export interface MentionAskPrep {
  mentions: ResolvedMention[];
  supplement: string;
  /** Set when Ask should skip the model and say this. */
  directAnswer: string | null;
  /** Grounded person answer, used when the model is skipped or unavailable. */
  fallbackAnswer: string | null;
  groundedOn: number;
}

export async function prepareMentionAsk(
  db: Db,
  input: { orgId: string; question: string; now?: Date },
): Promise<MentionAskPrep> {
  const roster = await listOrgMentionMembers(db, input.orgId);
  const resolution = resolveMentions(input.question, roster);
  const which = resolution.ambiguous
    .map((row) => ambiguitySentence(row.query, row.candidates))
    .join(' ');
  if (!resolution.mentions.length) {
    return {
      mentions: [],
      supplement: '',
      directAnswer: which || null,
      fallbackAnswer: which || null,
      groundedOn: 0,
    };
  }
  const people = await loadPersonContext(db, {
    orgId: input.orgId,
    people: resolution.mentions,
    question: input.question,
    now: input.now,
    roster,
  });
  const grounded = answerFromMentionContext(input.question, people);
  const hasRelevant = people.some((person) => person.items.some((item) => item.relevant));
  const supplement = [which, formatMentionPrompt(people)].filter(Boolean).join('\n\n');
  const withWhich = (answer: string) => (which ? `${which}\n\n${answer}` : answer);
  if (!hasRelevant || !isAskModelConfigured()) {
    return {
      mentions: resolution.mentions,
      supplement,
      directAnswer: withWhich(grounded.answer),
      fallbackAnswer: withWhich(grounded.answer),
      groundedOn: grounded.groundedOn,
    };
  }
  return {
    mentions: resolution.mentions,
    supplement,
    directAnswer: null,
    fallbackAnswer: withWhich(grounded.answer),
    groundedOn: grounded.groundedOn,
  };
}

export async function recordContentMentions(
  db: Db,
  input: {
    orgId: string;
    jobId?: string | null;
    source: 'job_message' | 'work_log' | 'job_proof' | 'ask_question';
    sourceId: string | null | undefined;
    mentions: ResolvedMention[];
  },
): Promise<void> {
  if (!input.sourceId || !input.mentions.length) return;
  const rows = input.mentions.map((mention) => ({
    org_id: input.orgId,
    mentioned_user_id: mention.userId,
    handle: mention.handle,
    source: input.source,
    source_id: input.sourceId,
    job_id: input.jobId ?? null,
  }));
  try {
    const result = await (db.from('content_mentions') as any).upsert(rows, {
      onConflict: 'source,source_id,mentioned_user_id',
    });
    if (result?.error && /does not exist|content_mentions/i.test(String(result.error.message ?? ''))) return;
  } catch {
    /* Table may not be migrated yet — the @ text is still searchable. */
  }
}
