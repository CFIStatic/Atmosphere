/**
 * Load org-scoped evidence for people named with @mentions, then either
 * answer directly (nothing relevant, or no model) or hand a ranked dossier
 * to the existing Ask model call.
 */
import { fieldCaptureEmail } from '../field/crewJoin.js';
import { isAskModelConfigured } from '../lib/askModel.js';
import { unscopedAdminOrNull } from '../lib/scopedAdmin.js';
import {
  ambiguitySentence,
  answerFromMentionContext,
  asksForPersonActivity,
  carryPriorMention,
  formatActivityDossier,
  formatMentionPrompt,
  personHasActivity,
  loginNameFromMetadata,
  mentionDisplayName,
  nameKey,
  notOnJobSentence,
  orderMentionItems,
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

function findingsBlurbs(findings: unknown): string {
  if (!findings || typeof findings !== 'object') return '';
  const events = (findings as { events?: unknown }).events;
  if (!Array.isArray(events)) return '';
  return events
    .map((event) => {
      if (!event || typeof event !== 'object') return '';
      return String((event as { text?: unknown }).text ?? '').trim();
    })
    .filter(Boolean)
    .slice(0, 6)
    .join(' ');
}

function clipText(row: any): string {
  return [row.ai_summary, row.narration_text, row.transcript_text, findingsBlurbs(row.ai_findings)]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 1800);
}

function sentences(text: string): string[] {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.match(/[^.!?]+[.!?]+(?:\s|$)/g)?.map((part) => part.trim()).filter(Boolean);
  return parts?.length ? parts : [clean.slice(0, 280).trim()];
}

function firstSentence(text: string): string {
  const sentence = sentences(text)[0] ?? '';
  if (sentence.length <= 420) return sentence;
  return sentence.slice(0, 400).replace(/\s+\S*$/, '').trim();
}

/** One scene line. Opening black frames are not the detail a list should lead with. */
function visualDetail(findings: unknown): string {
  if (!findings || typeof findings !== 'object') return '';
  const events = (findings as { events?: unknown }).events;
  if (!Array.isArray(events)) return '';
  const lines = events
    .map((event) => {
      if (!event || typeof event !== 'object') return '';
      return String((event as { text?: unknown }).text ?? '').replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
  const opener = /black|noisy|no subject|initializ|lens appears covered|no discernible/i;
  const picked = lines.find((line) => !opener.test(line)) ?? lines[0] ?? '';
  return firstSentence(picked);
}

function clipListLine(row: any): string {
  const parts = sentences(String(row.ai_summary ?? ''));
  const summary = firstSentence(parts[0] ?? '');
  const visual = visualDetail(row.ai_findings) || (parts[1] ? firstSentence(parts[1]) : '');
  return [summary, visual].filter(Boolean).join(' ');
}

/** A couple of real sentences from the mic. Fragments stay out of the dossier. */
function speechHighlight(transcript: unknown): string {
  const clean = String(transcript ?? '').replace(/\[[0-9:]+\]\s*/g, ' ');
  const spoken = sentences(clean).filter((line) => line.split(/\s+/).filter(Boolean).length >= 8);
  return spoken.slice(0, 2).join(' ');
}

function keyFindings(findings: unknown): string {
  if (!findings || typeof findings !== 'object') return '';
  const events = (findings as { events?: unknown }).events;
  if (!Array.isArray(events)) return '';
  const opener = /black|noisy|no subject|initializ|lens appears covered|no discernible/i;
  const lines = events
    .map((event) => {
      if (!event || typeof event !== 'object') return '';
      return firstSentence(String((event as { text?: unknown }).text ?? ''));
    })
    .filter((line) => line && !opener.test(line));
  return lines.slice(0, 3).join(' ');
}

function clipDetail(row: any): string {
  const summary = sentences(String(row.ai_summary ?? '')).slice(0, 2).join(' ');
  const shown = keyFindings(row.ai_findings);
  const said = speechHighlight(row.transcript_text);
  return [
    summary ? `Summary: ${summary}` : '',
    shown ? `Shown: ${shown}` : '',
    said ? `Speech (weave into a sentence only if it explains what they did or said): ${said}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function metadataUserId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const record = meta as Record<string, unknown>;
  for (const key of ['userId', 'user_id', 'actorUserId', 'actor_user_id', 'recorderUserId', 'recorder_user_id']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function proofCapturedBy(
  proof: any,
  userId: string,
  parties: Map<string, any>,
  uploads: Set<string>,
  acks: Set<string>,
  aliases: Set<string>,
): boolean {
  const ids = new Set([userId, ...aliases]);
  const party = parties.get(String(proof.party_id ?? ''));
  if (party?.created_by && ids.has(String(party.created_by))) return true;
  for (const id of ids) {
    if (uploads.has(`${id}:${proof.id}`)) return true;
    if (acks.has(`${id}:${proof.job_id}:${proof.work_date}`)) return true;
  }
  const recorded = metadataUserId(proof.device_metadata);
  return Boolean(recorded && ids.has(recorded));
}

/**
 * Field Capture crew logins are a separate auth user whose email is the
 * display name plus the org. Attach that seat only when one org member has
 * the name, so two people are never collapsed together.
 */
async function fieldSeatAliases(
  db: Db,
  orgId: string,
  people: ResolvedMention[],
  roster: MentionMember[],
): Promise<Map<string, Set<string>>> {
  const aliases = new Map<string, Set<string>>();
  for (const person of people) {
    const sameName = roster.filter((member) => nameKey(mentionDisplayName(member)) === nameKey(person.name));
    if (sameName.length !== 1) continue;
    const email = fieldCaptureEmail(orgId, person.name);
    const rows = await selectRows(db, 'profiles', (query) => query.select('id, email').eq('email', email));
    const seatId = String(rows[0]?.id ?? '');
    if (!seatId || seatId === person.userId) continue;
    const set = aliases.get(person.userId) ?? new Set<string>();
    set.add(seatId);
    aliases.set(person.userId, set);
  }
  return aliases;
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
  const aliasesByUser = await fieldSeatAliases(db, orgId, people, roster);

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
    selectRows(db, 'work_logs', (query) => {
      const filtered = query
        .select('id, job_id, author_id, body, kind, occurred_at')
        .eq('org_id', orgId)
        .in('author_id', userIds);
      return (scopeJobId ? filtered.eq('job_id', scopeJobId) : filtered)
        .order('occurred_at', { ascending: false })
        .limit(40);
    }),
    selectRows(db, 'content_mentions', (query) => {
      const filtered = query
        .select('mentioned_user_id, source, source_id, job_id, handle, created_at')
        .eq('org_id', orgId)
        .in('mentioned_user_id', userIds);
      return (scopeJobId ? filtered.eq('job_id', scopeJobId) : filtered)
        .order('created_at', { ascending: false })
        .limit(80);
    }),
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

  // Caps apply after this filter so newer rows on other jobs cannot evict this job.
  const evidenceJobIds = scopeJobId ? [scopeJobId] : jobIds;

  const aliasIds = [...aliasesByUser.values()].flatMap((ids) => [...ids]);
  const actorIds = [...new Set([...userIds, ...aliasIds])];
  const onJob = (query: any) => (scopeJobId ? query.eq('job_id', scopeJobId) : query);

  const [jobs, proofs, parties, recentMessages, taggedNotes, custody, shares, memory, scopeDocs] = await Promise.all([
    evidenceJobIds.length
      ? selectRows(db, 'crm_jobs', (query) =>
          query
            .select('id, job_number, title, status, work_type, owner_id, created_by, updated_at')
            .eq('org_id', orgId)
            .in('id', evidenceJobIds),
        )
      : Promise.resolve([] as any[]),
    evidenceJobIds.length
      ? selectRows(db, 'job_proofs', (query) =>
          query
            .select(
              'id, job_id, party_id, work_date, phase, state, title, ai_summary, transcript_text, narration_text, ai_findings, device_metadata, duration_seconds, captured_at, received_at',
            )
            .eq('org_id', orgId)
            .in('job_id', evidenceJobIds)
            .is('deleted_at', null)
            .order('work_date', { ascending: false })
            .limit(scopeJobId ? 200 : 60),
        )
      : Promise.resolve([] as any[]),
    evidenceJobIds.length
      ? selectRows(db, 'job_parties', (query) =>
          query
            .select('id, job_id, created_by, company, trade')
            .eq('org_id', orgId)
            .in('job_id', evidenceJobIds),
        )
      : Promise.resolve([] as any[]),
    selectRows(db, 'job_messages', (query) => {
      const filtered = query
        .select('id, job_id, author_id, author_label, body, created_at')
        .eq('org_id', orgId);
      return (scopeJobId ? filtered.eq('job_id', scopeJobId) : filtered)
        .order('created_at', { ascending: false })
        .limit(120);
    }),
    taggedNoteIds.length
      ? selectRows(db, 'job_messages', (query) =>
          query
            .select('id, job_id, author_id, author_label, body, created_at')
            .eq('org_id', orgId)
            .in('id', taggedNoteIds),
        )
      : Promise.resolve([] as any[]),
    actorIds.length
      ? selectRows(db, 'job_evidence_access', (query) =>
          onJob(
            query
              .select('id, proof_id, job_id, actor_id, action, detail, occurred_at')
              .eq('org_id', orgId)
              .in('actor_id', actorIds),
          )
            .order('occurred_at', { ascending: false })
            .limit(80),
        )
      : Promise.resolve([] as any[]),
    actorIds.length
      ? selectRows(db, 'verifier_shares', (query) =>
          onJob(
            query
              .select('id, job_id, label, created_by, created_at, revoked_at')
              .eq('org_id', orgId)
              .in('created_by', actorIds),
          )
            .order('created_at', { ascending: false })
            .limit(20),
        )
      : Promise.resolve([] as any[]),
    actorIds.length
      ? selectRows(db, 'memory_events', (query) =>
          onJob(
            query
              .select('id, job_id, actor_id, event_type, summary, occurred_at')
              .eq('org_id', orgId)
              .in('actor_id', actorIds),
          )
            .order('occurred_at', { ascending: false })
            .limit(40),
        )
      : Promise.resolve([] as any[]),
    actorIds.length
      ? selectRows(db, 'scope_documents', (query) =>
          onJob(
            query
              .select('id, job_id, filename, uploaded_by, created_at')
              .eq('org_id', orgId)
              .in('uploaded_by', actorIds),
          )
            .order('created_at', { ascending: false })
            .limit(20),
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

    const aliases = aliasesByUser.get(person.userId) ?? new Set<string>();
    for (const proof of proofs) {
      const jobId = String(proof.job_id ?? '');
      if (!jobsById.has(jobId) && !assigned.has(`${person.userId}:${jobId}`)) continue;
      const captured = proofCapturedBy(proof, person.userId, partiesById, uploadKeys, ackKeys, aliases);
      const tagged = textMentionsPerson(clipText(proof), person.userId, roster);
      if (!captured && !tagged) continue;
      const title = String(proof.title || `${proof.phase ?? 'clip'} ${proof.work_date ?? ''}`.trim());
      const duration = Number(proof.duration_seconds);
      push({
        kind: 'video',
        id: String(proof.id),
        jobId,
        proofId: String(proof.id),
        title,
        text: clipText(proof),
        listLine: clipListLine(proof),
        detail: clipDetail(proof),
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
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
      const authored = message.author_id === person.userId;
      const tagged =
        textMentionsPerson(body, person.userId, roster) ||
        Boolean(taggedForUser.get(person.userId)?.has(`job_message:${message.id}`));
      // A comment they wrote belongs in an activity rundown. It does not, by
      // itself, answer a narrower question such as "did she finish the electrical job?"
      if (authored && !tagged && !asksForPersonActivity(input.question, [person.name])) continue;
      if (!authored && !tagged) continue;
      push({
        kind: 'note',
        id: String(message.id),
        jobId: message.job_id ?? null,
        title: authored ? 'Comment' : String(message.author_label ?? 'Note'),
        text: body,
        at: message.created_at ?? null,
        captured: authored,
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

    const ids = new Set([person.userId, ...(aliasesByUser.get(person.userId) ?? [])]);
    for (const party of parties) {
      if (!ids.has(String(party.created_by ?? ''))) continue;
      const company = String(party.company ?? 'party').trim();
      push({
        kind: 'log',
        id: `party:${party.job_id}:${company}`,
        jobId: party.job_id ?? null,
        title: `Created the ${company} party`,
        text: '',
        at: null,
        captured: true,
      });
    }
    for (const row of custody) {
      if (!ids.has(String(row.actor_id ?? ''))) continue;
      const action = String(row.action ?? '');
      if (action === 'uploaded' || action === 'viewed' || action === 'analysed') continue;
      push({
        kind: 'log',
        id: `custody:${row.id ?? `${row.proof_id}:${action}:${row.occurred_at}`}`,
        jobId: row.job_id ?? null,
        title: `${action} evidence`,
        text: String(row.detail ?? ''),
        at: row.occurred_at ?? null,
        captured: true,
      });
    }
    for (const share of shares) {
      if (!ids.has(String(share.created_by ?? ''))) continue;
      push({
        kind: 'log',
        id: `share:${share.id}`,
        jobId: share.job_id ?? null,
        title: `Shared the file with ${String(share.label ?? 'someone')}`,
        text: share.revoked_at ? 'Revoked' : 'Open',
        at: share.created_at ?? null,
        captured: true,
      });
    }
    for (const event of memory) {
      if (!ids.has(String(event.actor_id ?? ''))) continue;
      const summary = String(event.summary ?? '').trim();
      if (!summary) continue;
      push({
        kind: 'log',
        id: `memory:${event.id}`,
        jobId: event.job_id ?? null,
        title: String(event.event_type ?? 'Job history'),
        text: summary,
        at: event.occurred_at ?? null,
        captured: true,
      });
    }
    for (const doc of scopeDocs) {
      if (!ids.has(String(doc.uploaded_by ?? ''))) continue;
      push({
        kind: 'log',
        id: `scope:${doc.id}`,
        jobId: doc.job_id ?? null,
        title: `Uploaded ${String(doc.filename ?? 'a scope document')}`,
        text: '',
        at: doc.created_at ?? null,
        captured: true,
      });
    }

    const ranked = orderMentionItems(items, input.question, now, [person.name]).slice(0, 40);
    const fileContains = scopeJobId
      ? [
          ...jobs.map((job) => [job.job_number ? `#${job.job_number}` : '', job.title].filter(Boolean).join(' ')),
          ...proofs.map((proof) => String(proof.title || '').trim()),
        ].filter(Boolean)
      : [];
    const scopedJob = scopeJobId ? jobsById.get(scopeJobId) : null;
    return {
      userId: person.userId,
      handle: person.handle,
      name: person.name,
      items: ranked,
      fileContains,
      jobTitle: scopedJob?.title ? String(scopedJob.title) : null,
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
  input: {
    orgId: string;
    question: string;
    now?: Date;
    jobId?: string | null;
    history?: Array<{ role?: string | null; text?: string | null }> | null;
    /** When this is the mentioned person, the answer may say "you". */
    askerUserId?: string | null;
  },
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
  const carried = carryPriorMention(input.question, input.history, roster);
  const resolution = carried
    ? { mentions: [carried], ambiguous: [] as { query: string; candidates: Array<{ name: string }> }[] }
    : resolveMentions(input.question, roster);
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
  const askerUserId = input.askerUserId ?? null;
  const grounded = answerFromMentionContext(input.question, people, { askerUserId });
  const hasActivity = people.some((person) => personHasActivity(person));
  const dossier = hasActivity
    ? formatActivityDossier(people, { askerUserId })
    : formatMentionPrompt(people);
  const supplement = [which, absent, dossier].filter(Boolean).join('\n\n');
  const withPrefix = (answer: string) => [which, absent, answer].filter(Boolean).join('\n\n');
  // A person with real activity is never answered by the canned miss or the
  // clip-list template while a model is configured. The dossier goes to the model.
  if (!hasActivity || !isAskModelConfigured()) {
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
