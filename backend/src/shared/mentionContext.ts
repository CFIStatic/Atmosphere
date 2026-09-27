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
  notOnJobSentence,
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

function asProfile(row: any): { email: string | null; fullName: string | null; avatarUrl: string | null } {
  const profile = Array.isArray(row?.profiles) ? row.profiles[0] : row?.profiles;
  const avatar = typeof profile?.avatar_url === 'string' ? profile.avatar_url.trim() : '';
  return {
    email: profile?.email ?? null,
    fullName: profile?.full_name ?? null,
    avatarUrl: /^(https?:|data:image\/)/.test(avatar) ? avatar : null,
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
      .select('user_id, status, profiles(email, full_name, avatar_url, handle)')
      .eq('org_id', orgId),
  );
  const rows = withHandle.length
    ? withHandle
    : await selectRows(db, 'org_members', (query) =>
        query.select('user_id, status, profiles(email, full_name, avatar_url)').eq('org_id', orgId),
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
      avatarUrl: profile.avatarUrl,
    });
  }
  return fillLoginNames(identities);
}

async function jobInOrg(
  db: Db,
  orgId: string,
  jobId: string,
): Promise<{ id: string; title: string } | null> {
  const rows = await selectRows(db, 'crm_jobs', (query) =>
    query.select('id, title, job_number').eq('org_id', orgId).eq('id', jobId).limit(1),
  );
  const row = rows[0];
  if (!row) return null;
  const title = [row.job_number ? `#${row.job_number}` : '', row.title].filter(Boolean).join(' ').trim();
  return { id: String(row.id), title: title || 'Job' };
}

/**
 * People on one job in this org: assigned, owner, captured a proof, or tagged
 * in a note. A job id from another org returns null.
 */
export async function listJobMentionUserIds(
  db: Db,
  orgId: string,
  jobId: string,
  roster: MentionMember[],
): Promise<Set<string> | null> {
  const job = await jobInOrg(db, orgId, jobId);
  if (!job) return null;
  const [assignments, uploads, parties, acks, tags, messages, owners] = await Promise.all([
    selectRows(db, 'job_assignments', (query) =>
      query.select('user_id, released_at').eq('org_id', orgId).eq('job_id', jobId),
    ),
    selectRows(db, 'job_evidence_access', (query) =>
      query.select('actor_id, action').eq('org_id', orgId).eq('job_id', jobId).eq('action', 'uploaded'),
    ),
    selectRows(db, 'job_parties', (query) =>
      query.select('created_by').eq('org_id', orgId).eq('job_id', jobId),
    ),
    selectRows(db, 'recording_acknowledgments', (query) =>
      query.select('actor_user_id').eq('org_id', orgId).eq('job_id', jobId),
    ),
    selectRows(db, 'content_mentions', (query) =>
      query.select('mentioned_user_id, source').eq('org_id', orgId).eq('job_id', jobId),
    ),
    selectRows(db, 'job_messages', (query) =>
      query.select('body').eq('org_id', orgId).eq('job_id', jobId).order('created_at', { ascending: false }).limit(80),
    ),
    selectRows(db, 'crm_jobs', (query) =>
      query.select('owner_id, created_by').eq('org_id', orgId).eq('id', jobId),
    ),
  ]);
  const ids = new Set<string>();
  const orgIds = new Set(roster.map((member) => member.userId));
  const add = (value: unknown) => {
    const id = String(value ?? '');
    if (id && orgIds.has(id)) ids.add(id);
  };
  for (const row of owners) {
    add(row.owner_id);
    add(row.created_by);
  }
  for (const row of assignments) {
    if (!row.released_at) add(row.user_id);
  }
  for (const row of uploads) add(row.actor_id);
  for (const row of parties) add(row.created_by);
  for (const row of acks) add(row.actor_user_id);
  for (const row of tags) {
    if (!row.source || row.source === 'job_message' || row.source === 'job_proof' || row.source === 'work_log') {
      add(row.mentioned_user_id);
    }
  }
  for (const row of messages) {
    for (const mention of resolveMentions(String(row.body ?? ''), roster).mentions) add(mention.userId);
  }
  return ids;
}

export async function listJobMentionMembers(
  db: Db,
  orgId: string,
  jobId: string,
): Promise<MentionMember[] | null> {
  const roster = await listOrgMentionMembers(db, orgId);
  const ids = await listJobMentionUserIds(db, orgId, jobId, roster);
  if (!ids) return null;
  return roster.filter((member) => ids.has(member.userId));
}

/** Other jobs in this org the person is on, for the "isn't on this job" reply. */
async function otherJobsForUser(
  db: Db,
  orgId: string,
  userId: string,
  exceptJobId: string,
): Promise<string[]> {
  const [assignments, owned, created, uploads, parties, acks, tags] = await Promise.all([
    selectRows(db, 'job_assignments', (query) =>
      query.select('job_id, released_at').eq('org_id', orgId).eq('user_id', userId),
    ),
    selectRows(db, 'crm_jobs', (query) =>
      query.select('id, title, job_number').eq('org_id', orgId).eq('owner_id', userId),
    ),
    selectRows(db, 'crm_jobs', (query) =>
      query.select('id, title, job_number').eq('org_id', orgId).eq('created_by', userId),
    ),
    selectRows(db, 'job_evidence_access', (query) =>
      query.select('job_id').eq('org_id', orgId).eq('actor_id', userId).eq('action', 'uploaded'),
    ),
    selectRows(db, 'job_parties', (query) =>
      query.select('job_id').eq('org_id', orgId).eq('created_by', userId),
    ),
    selectRows(db, 'recording_acknowledgments', (query) =>
      query.select('job_id').eq('org_id', orgId).eq('actor_user_id', userId),
    ),
    selectRows(db, 'content_mentions', (query) =>
      query.select('job_id').eq('org_id', orgId).eq('mentioned_user_id', userId),
    ),
  ]);
  const titles = new Map<string, string>();
  const remember = (id: unknown, title?: string) => {
    const jobId = String(id ?? '');
    if (!jobId || jobId === exceptJobId || titles.has(jobId)) return;
    titles.set(jobId, title?.trim() || '');
  };
  for (const row of [...owned, ...created]) {
    const title = [row.job_number ? `#${row.job_number}` : '', row.title].filter(Boolean).join(' ');
    remember(row.id, title);
  }
  for (const row of assignments) {
    if (!row.released_at) remember(row.job_id);
  }
  for (const row of uploads) remember(row.job_id);
  for (const row of parties) remember(row.job_id);
  for (const row of acks) remember(row.job_id);
  for (const row of tags) remember(row.job_id);
  const missing = [...titles.entries()].filter(([, title]) => !title).map(([id]) => id);
  if (missing.length) {
    const jobs = await selectRows(db, 'crm_jobs', (query) =>
      query.select('id, title, job_number').eq('org_id', orgId).in('id', missing),
    );
    for (const row of jobs) {
      const title = [row.job_number ? `#${row.job_number}` : '', row.title].filter(Boolean).join(' ');
      if (title) titles.set(String(row.id), title);
    }
  }
  return [...titles.values()].filter(Boolean);
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
    /** When set, evidence is limited to this job. */
    jobId?: string | null;
  },
): Promise<PersonMentionContext[]> {
  const { orgId, people } = input;
  if (!people.length) return [];
  const scopeJobId = input.jobId ? String(input.jobId) : null;
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
      if (scopeJobId && item.jobId !== scopeJobId && item.id !== scopeJobId) return;
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
  input: { orgId: string; question: string; now?: Date; jobId?: string | null },
): Promise<MentionAskPrep> {
  const roster = await listOrgMentionMembers(db, input.orgId);
  const jobId = input.jobId ? String(input.jobId) : null;
  if (jobId) {
    const job = await jobInOrg(db, input.orgId, jobId);
    if (!job) {
      const missing = "That job isn't in this organization.";
      return { mentions: [], supplement: '', directAnswer: missing, fallbackAnswer: missing, groundedOn: 0 };
    }
  }
  const resolution = resolveMentions(input.question, roster);
  const which = resolution.ambiguous
    .map((row) => ambiguitySentence(row.query, row.candidates))
    .join(' ');
  let mentions = resolution.mentions;
  let absent = '';
  if (jobId && mentions.length) {
    const onJob = await listJobMentionUserIds(db, input.orgId, jobId, roster);
    const allowed = onJob ?? new Set<string>();
    const off = mentions.filter((person) => !allowed.has(person.userId));
    mentions = mentions.filter((person) => allowed.has(person.userId));
    if (off.length) {
      const lines = await Promise.all(
        off.map(async (person) =>
          notOnJobSentence(person.name, await otherJobsForUser(db, input.orgId, person.userId, jobId)),
        ),
      );
      absent = lines.join(' ');
    }
  }
  if (!mentions.length) {
    const direct = [which, absent].filter(Boolean).join('\n\n');
    return {
      mentions: [],
      supplement: '',
      directAnswer: direct || null,
      fallbackAnswer: direct || null,
      groundedOn: 0,
    };
  }
  const people = await loadPersonContext(db, {
    orgId: input.orgId,
    people: mentions,
    question: input.question,
    now: input.now,
    roster,
    jobId,
  });
  const grounded = answerFromMentionContext(input.question, people);
  const hasRelevant = people.some((person) => person.items.some((item) => item.relevant));
  const supplement = [which, absent, formatMentionPrompt(people)].filter(Boolean).join('\n\n');
  const withPrefix = (answer: string) => [which, absent, answer].filter(Boolean).join('\n\n');
  if (!hasRelevant || !isAskModelConfigured()) {
    return {
      mentions,
      supplement,
      directAnswer: withPrefix(grounded.answer),
      fallbackAnswer: withPrefix(grounded.answer),
      groundedOn: grounded.groundedOn,
    };
  }
  return {
    mentions,
    supplement,
    directAnswer: null,
    fallbackAnswer: withPrefix(grounded.answer),
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
