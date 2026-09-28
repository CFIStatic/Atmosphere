/**
 * Job-file Timeline.
 *
 * Every row is a record that already exists: memory, clips, custody, shares,
 * access, scope, documents, revisions, or a live capture session. Nothing here
 * writes, and nothing here is synthesized when the source row is missing.
 */
import type {
  EvidenceShare,
  JobAccessPerson,
  JobCustodyExport,
  JobParty,
  MemoryEvent,
  OfficeLiveSession,
  OrgMember,
  ProofResponse,
  ProofVideoRecord,
  ScopeDocument,
  SharedJobRecord,
} from '../../lib/api';
import { formatClipLength } from '../../lib/clipDuration';
import { scrubHomeownerText } from '../../lib/privacyText';
import { dayIsOnSite } from './jobProgressStory';

export const TIMELINE_ZONE = 'America/Chicago';

export type TimelineKind =
  | 'job'
  | 'people'
  | 'clip'
  | 'analysis'
  | 'share'
  | 'custody'
  | 'history';

export type TimelineFilter = 'all' | 'live' | TimelineKind;

export type TimelinePoster = {
  id: string;
  jobId: string;
  posterUrl?: string | null;
  title?: string | null;
};

export type TimelineSource = {
  jobId: string;
  record: SharedJobRecord | null;
  proofs: ProofResponse | null;
  memory: MemoryEvent[];
  custody: JobCustodyExport | null;
  shares: EvidenceShare[];
  access: JobAccessPerson[];
  scopeDoc: ScopeDocument | null;
  liveSessions: OfficeLiveSession[];
  posters: TimelinePoster[];
  members: OrgMember[];
};

export type TimelineEvent = {
  id: string;
  at: string;
  kind: TimelineKind;
  sentence: string;
  actorName: string | null;
  actorEmail: string | null;
  avatarUrl: string | null;
  live: boolean;
  posterUrl: string | null;
  proofId: string | null;
  seekSeconds: number | null;
  durationSeconds: number | null;
  privacyRedactions: ProofVideoRecord['privacyRedactions'] | null;
  childPrivacyRedactions: ProofVideoRecord['childPrivacyRedactions'] | null;
};

const LEGACY_SECTIONS = new Set([
  'happening',
  'happening-now',
  'happening_now',
  'history',
  'job-history',
  'job_history',
  'jobhistory',
  'packet',
  'packets',
  'claim-ready',
  'claim_ready',
  'claimready',
]);

const CHILD_WORD = /\b(child|children|toddler|kid|kids|minor|baby|infant)\b/i;
const REDACTION_MARK = /\[(?:child )?privacy redacted\]/i;

export function isLegacyJobFileSection(value: string | null | undefined): boolean {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
  return LEGACY_SECTIONS.has(key);
}

/** Chat unless the URL already asks for Timeline or a legacy tab. */
export function initialJobFileSection(search: string, hash = ''): 'chat' | 'timeline' {
  if (timelineRedirectSearch(search, hash)) return 'timeline';
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get('section') === 'timeline' ? 'timeline' : 'chat';
}

/** Old Happening Now, Job history, and Packet links become ?section=timeline. */
export function timelineRedirectSearch(search: string, hash = ''): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const section = params.get('section');
  const tab = params.get('tab');
  const hashKey = hash.replace(/^#/, '');
  if (!isLegacyJobFileSection(section) && !isLegacyJobFileSection(tab) && !isLegacyJobFileSection(hashKey)) {
    return null;
  }
  params.delete('tab');
  params.delete('ask');
  params.set('section', 'timeline');
  const next = params.toString();
  return next ? `?${next}` : '?section=timeline';
}

/**
 * `/jobs/:id/packet` and `?section=packet` (or claim-ready) open this job's Timeline.
 * Other job-file bookmarks stay on the plain job path.
 */
export function packetTimelineLocation(
  jobId: string,
  pathname: string,
  search: string,
  hash = '',
): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (jobId) params.set('job', jobId);
  const tail = pathname.split('/').filter(Boolean).pop()?.toLowerCase() ?? '';
  if (isLegacyJobFileSection(tail) && (tail === 'packet' || tail === 'packets' || tail.startsWith('claim'))) {
    params.set('section', tail);
  }
  const rewritten = timelineRedirectSearch(`?${params.toString()}`, hash);
  if (!rewritten) return null;
  return `/job-progress${rewritten}`;
}

export function formatCtTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMELINE_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${clock} CT`;
}

export function formatCtDay(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMELINE_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function ctDayKey(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMELINE_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function stamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? value : null;
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sentence(value: string): string {
  const body = value.replace(/\s+/g, ' ').trim();
  if (!body) return '';
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

function withActor(actor: string | null, summary: string): string {
  const body = summary.replace(/[.!?]$/, '').trim();
  if (!body) return '';
  if (!actor) {
    return sentence(body.charAt(0).toUpperCase() + body.slice(1));
  }
  if (body.toLowerCase().startsWith(actor.toLowerCase())) return sentence(body);
  return sentence(`${actor} ${body.charAt(0).toLowerCase()}${body.slice(1)}`);
}

function rowField(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function memberFor(
  members: OrgMember[],
  actorId: string | null | undefined,
  email: string | null | undefined,
): OrgMember | null {
  if (actorId) {
    const byId = members.find((member) => member.userId === actorId);
    if (byId) return byId;
  }
  const mail = text(email).toLowerCase();
  if (!mail) return null;
  return members.find((member) => text(member.email).toLowerCase() === mail) ?? null;
}

function actorFromMember(member: OrgMember | null, email: string | null): {
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
} {
  const name = text(member?.fullName) || text(email) || null;
  return {
    name,
    email: text(member?.email) || text(email) || null,
    avatarUrl: member?.avatarUrl ?? null,
  };
}

function clipLengthPhrase(seconds: number | null | undefined): string | null {
  const spoken = formatClipLength(seconds);
  if (!spoken || spoken === '—') return null;
  return spoken;
}

function childClip(video: ProofVideoRecord | undefined): boolean {
  return Boolean(video?.childPrivacyRedactions?.ranges?.length);
}

/** Office prose that is safe to put in a sentence. Transcripts stay out. */
export function publicFinding(value: string | null | undefined, child: boolean): string | null {
  if (child) return null;
  const clean = scrubHomeownerText(value);
  if (!clean || REDACTION_MARK.test(clean) || CHILD_WORD.test(clean)) return null;
  return clean;
}

function roomPhrase(video: ProofVideoRecord | undefined): string | null {
  const rooms = video?.conversation?.conversationRooms ?? [];
  for (const room of rooms) {
    const clean = publicFinding(room, false);
    if (!clean) continue;
    const lower = clean.replace(/_/g, ' ').toLowerCase();
    if (/^(the|a|an)\b/.test(lower)) return `in ${lower}`;
    return `in the ${lower}`;
  }
  return null;
}

function clipWho(video: ProofVideoRecord): string {
  const person = text(video.person);
  if (person) return person;
  const company = text(video.company);
  if (company && company.toLowerCase() !== 'company') return company;
  return 'Someone';
}

function posterFor(source: TimelineSource, proofId: string | null): string | null {
  if (!proofId) return null;
  const row = source.posters.find((poster) => poster.id === proofId && poster.jobId === source.jobId);
  const url = text(row?.posterUrl);
  return url || null;
}

function blankMedia(partial: Partial<TimelineEvent> = {}): Pick<
  TimelineEvent,
  | 'posterUrl'
  | 'proofId'
  | 'seekSeconds'
  | 'durationSeconds'
  | 'privacyRedactions'
  | 'childPrivacyRedactions'
> {
  return {
    posterUrl: partial.posterUrl ?? null,
    proofId: partial.proofId ?? null,
    seekSeconds: partial.seekSeconds ?? null,
    durationSeconds: partial.durationSeconds ?? null,
    privacyRedactions: partial.privacyRedactions ?? null,
    childPrivacyRedactions: partial.childPrivacyRedactions ?? null,
  };
}

function push(
  out: TimelineEvent[],
  event: Omit<TimelineEvent, 'posterUrl' | 'proofId' | 'seekSeconds' | 'durationSeconds' | 'privacyRedactions' | 'childPrivacyRedactions'> &
    Partial<Pick<TimelineEvent, 'posterUrl' | 'proofId' | 'seekSeconds' | 'durationSeconds' | 'privacyRedactions' | 'childPrivacyRedactions'>>,
) {
  const at = stamp(event.at);
  const line = sentence(event.sentence);
  if (!at || !line) return;
  out.push({
    ...event,
    at,
    sentence: line,
    ...blankMedia(event),
  });
}

function close(a: string, b: string, ms = 3 * 60_000): boolean {
  return Math.abs(Date.parse(a) - Date.parse(b)) <= ms;
}

function videoById(source: TimelineSource): Map<string, ProofVideoRecord> {
  return new Map((source.proofs?.videos ?? []).map((video) => [video.id, video]));
}

function partyName(party: JobParty): string {
  return text(party.contactName) || text(party.contact_name) || text(party.company) || 'Someone';
}

function memoryEvents(source: TimelineSource, out: TimelineEvent[]) {
  for (const event of source.memory) {
    if (event.jobId && event.jobId !== source.jobId) continue;
    const summary = text(event.summary);
    if (!summary) continue;
    const at = stamp(event.occurredAt);
    if (!at) continue;
    const member = memberFor(source.members, event.actorId, event.actorEmail);
    const actor = actorFromMember(member, event.actorEmail);
    const snapshotTitle = text(rowField(event.snapshot ?? {}, 'title'));
    const titleChange = event.changes?.title;
    let line: string;
    let kind: TimelineKind = 'history';
    if (event.eventType.startsWith('job.')) kind = 'job';
    else if (event.eventType.startsWith('assignment.')) kind = 'people';

    if (event.eventType === 'job.updated' && titleChange) {
      const from = text(titleChange.from) || 'the previous name';
      const to = text(titleChange.to) || snapshotTitle || 'the new name';
      line = `${actor.name ?? 'Someone'} renamed the job from ${from} to ${to}`;
    } else if (event.eventType === 'job.created' && /^copy of /i.test(snapshotTitle)) {
      line = `${actor.name ?? 'Someone'} duplicated the job file as ${snapshotTitle}`;
    } else {
      line = withActor(actor.name, summary).replace(/\.$/, '');
    }

    push(out, {
      id: `memory:${event.id}`,
      at,
      kind,
      sentence: line,
      actorName: actor.name,
      actorEmail: actor.email,
      avatarUrl: actor.avatarUrl,
      live: false,
    });
  }
}

function clipEvents(source: TimelineSource, out: TimelineEvent[]) {
  const videos = source.proofs?.videos ?? [];
  for (const video of videos) {
    const captured = stamp(video.capturedAt);
    const received = stamp(video.receivedAt);
    const at = captured ?? received;
    if (!at) continue;
    const who = clipWho(video);
    const length = clipLengthPhrase(video.durationSeconds);
    const where = roomPhrase(video);
    const verb = captured ? 'recorded' : 'uploaded';
    const clip = length ? `a clip lasting ${length}` : 'a clip';
    const member = source.members.find(
      (row) => text(row.fullName).toLowerCase() === who.toLowerCase(),
    );
    push(out, {
      id: `clip:${video.id}`,
      at,
      kind: 'clip',
      sentence: `${who} ${verb} ${clip}${where ? ` ${where}` : ''}`,
      actorName: who,
      actorEmail: member?.email ?? null,
      avatarUrl: member?.avatarUrl ?? null,
      live: false,
      posterUrl: posterFor(source, video.id),
      proofId: video.id,
      durationSeconds: video.durationSeconds,
      privacyRedactions: video.privacyRedactions ?? null,
      childPrivacyRedactions: video.childPrivacyRedactions ?? null,
    });

    const reading =
      video.analysisStatus === 'queued' ||
      video.analysisStatus === 'running' ||
      video.narrationStatus === 'queued' ||
      video.narrationStatus === 'running' ||
      video.transcriptStatus === 'queued' ||
      video.transcriptStatus === 'running';
    if (reading) {
      const place = where ? ` ${where}` : '';
      push(out, {
        id: `live:analysis:${video.id}`,
        at: received ?? at,
        kind: 'analysis',
        sentence: `Analysis is still reading ${who}'s clip${place}`,
        actorName: who,
        actorEmail: member?.email ?? null,
        avatarUrl: member?.avatarUrl ?? null,
        live: true,
        posterUrl: posterFor(source, video.id),
        proofId: video.id,
        durationSeconds: video.durationSeconds,
        privacyRedactions: video.privacyRedactions ?? null,
        childPrivacyRedactions: video.childPrivacyRedactions ?? null,
      });
    }
  }

  for (const day of source.proofs?.days ?? []) {
    if (!dayIsOnSite(day)) continue;
    const at = stamp(`${day.workDate}T12:00:00.000Z`);
    if (!at) continue;
    const company = text(day.company) || 'Crew';
    push(out, {
      id: `live:onsite:${day.partyId}:${day.workDate}`,
      at,
      kind: 'clip',
      sentence: `${company} is on site — the after clip is not filed yet`,
      actorName: company,
      actorEmail: null,
      avatarUrl: null,
      live: true,
    });
  }
}

function custodyEvents(source: TimelineSource, out: TimelineEvent[]) {
  const videos = videoById(source);
  const clipIds = new Set((source.proofs?.videos ?? []).map((video) => video.id));
  for (const clip of source.custody?.clips ?? []) {
    if (clip.job?.id && clip.job.id !== source.jobId) continue;
    const video = videos.get(clip.clip.id);
    const where = roomPhrase(video);
    const label = where ? `the clip ${where}` : 'the clip';
    for (const entry of clip.chainOfCustody ?? []) {
      const at = stamp(entry.at);
      if (!at) continue;
      const action = text(entry.action).toLowerCase();
      if (action === 'uploaded' && clipIds.has(clip.clip.id)) {
        const clipAt = stamp(video?.capturedAt) ?? stamp(video?.receivedAt) ?? stamp(clip.clip.receivedAt);
        if (clipAt && close(clipAt, at)) continue;
      }
      const actorName = text(entry.by) || text(clip.clip.filmedBy?.person) || null;
      const member = source.members.find(
        (row) => actorName && text(row.fullName).toLowerCase() === actorName.toLowerCase(),
      );
      const finding =
        action === 'analysed' ? publicFinding(video?.aiSummary, childClip(video)) : null;
      let kind: TimelineKind = 'custody';
      let line = `${actorName ?? 'Someone'} updated custody for ${label}`;
      if (action === 'uploaded') line = `${actorName ?? 'Someone'} filed ${label}`;
      else if (action === 'viewed') line = `${actorName ?? 'Someone'} opened ${label}`;
      else if (action === 'downloaded') line = `${actorName ?? 'Someone'} downloaded ${label}`;
      else if (action === 'analysed') {
        kind = 'analysis';
        line = finding
          ? `${actorName ?? 'Analysis'} finished reading ${label}. ${finding}`
          : `${actorName ?? 'Analysis'} finished reading ${label}`;
      } else if (action === 'accepted') line = `${actorName ?? 'Someone'} accepted the day for ${label}`;
      else if (action === 'rejected') line = `${actorName ?? 'Someone'} rejected the day for ${label}`;
      else if (action === 'held') line = `${actorName ?? 'Someone'} placed a hold on ${label}`;
      else if (action === 'released') line = `${actorName ?? 'Someone'} lifted the hold on ${label}`;
      else if (action === 'restored') line = `${actorName ?? 'Someone'} restored ${label}`;
      else if (action === 'deleted') line = `${actorName ?? 'Someone'} removed ${label} from the library`;
      else if (action === 'exported') {
        const detail = text(entry.detail);
        const report = /proof-pack|evidence/i.test(detail);
        const claimPacket = /claim/i.test(detail) && !report;
        if (claimPacket) continue;
        if (report) line = `${actorName ?? 'Someone'} exported the evidence report${detail ? ` (${detail})` : ''}`;
        else line = `${actorName ?? 'Someone'} exported a record from this job${detail ? ` (${detail})` : ''}`;
      } else if (action === 'shared') {
        kind = 'share';
        line = `${actorName ?? 'Someone'} shared ${label}`;
      }
      push(out, {
        id: `custody:${clip.clip.id}:${action}:${at}`,
        at,
        kind,
        sentence: line,
        actorName,
        actorEmail: member?.email ?? null,
        avatarUrl: member?.avatarUrl ?? null,
        live: false,
        posterUrl: posterFor(source, clip.clip.id),
        proofId: clip.clip.id,
        durationSeconds: video?.durationSeconds ?? clip.clip.durationSeconds,
        privacyRedactions: video?.privacyRedactions ?? null,
        childPrivacyRedactions: video?.childPrivacyRedactions ?? null,
      });
    }
  }
}

function shareEvents(source: TimelineSource, out: TimelineEvent[]) {
  for (const share of source.shares) {
    if (share.jobId !== source.jobId) continue;
    const created = stamp(share.createdAt);
    const label = text(share.label) || 'someone';
    const grant = source.access.find(
      (person) =>
        text(person.email).toLowerCase() === text(share.recipientEmail).toLowerCase() &&
        text(person.email) !== '',
    );
    const actorName = text(grant?.grantedByName) || null;
    const member = source.members.find(
      (row) => actorName && text(row.fullName).toLowerCase() === actorName.toLowerCase(),
    );
    const homeowner = share.kind === 'progress';
    if (created) {
      push(out, {
        id: `share:${share.id}`,
        at: created,
        kind: 'share',
        sentence: homeowner
          ? `${actorName ? `${actorName} shared` : 'Shared'} job progress with ${label}`
          : `${actorName ? `${actorName} shared` : 'Shared'} the evidence report with ${label}`,
        actorName,
        actorEmail: member?.email ?? (text(grant?.grantedByEmail) || null),
        avatarUrl: member?.avatarUrl ?? null,
        live: false,
      });
    }
    const revoked = stamp(share.revokedAt);
    if (revoked) {
      push(out, {
        id: `share:${share.id}:revoked`,
        at: revoked,
        kind: 'share',
        sentence: `Revoked the share with ${label}`,
        actorName,
        actorEmail: member?.email ?? null,
        avatarUrl: member?.avatarUrl ?? null,
        live: false,
      });
    }
  }
}

function accessEvents(source: TimelineSource, out: TimelineEvent[]) {
  for (const person of source.access) {
    const at = stamp(person.grantedAt);
    if (!at) continue;
    if (person.kind === 'homeowner') {
      const email = text(person.email).toLowerCase();
      const share = source.shares.find(
        (row) =>
          row.jobId === source.jobId &&
          text(row.recipientEmail).toLowerCase() === email &&
          email !== '' &&
          stamp(row.createdAt) &&
          close(stamp(row.createdAt) as string, at),
      );
      if (share) continue;
    }
    if (person.id.startsWith('party:')) continue;
    const name = text(person.displayName) || text(person.name) || text(person.email) || 'Someone';
    const granter = text(person.grantedByName) || null;
    const member = source.members.find(
      (row) => granter && text(row.fullName).toLowerCase() === granter.toLowerCase(),
    );
    const accessWord = text(person.displayLabel) || text(person.accessType) || 'access';
    push(out, {
      id: `access:${person.id}`,
      at,
      kind: 'people',
      sentence: granter
        ? `${granter} gave ${name} ${accessWord} access`
        : `${name} was given ${accessWord} access`,
      actorName: granter || name,
      actorEmail: text(person.grantedByEmail) || text(person.email) || null,
      avatarUrl: member?.avatarUrl ?? null,
      live: false,
    });
  }
}

function recordEvents(source: TimelineSource, out: TimelineEvent[]) {
  const record = source.record;
  if (!record || record.job.id !== source.jobId) return;

  for (const party of record.parties) {
    const name = partyName(party);
    const member = source.members.find(
      (row) => text(row.fullName).toLowerCase() === name.toLowerCase(),
    );
    const created = stamp(rowField(party, 'created_at'));
    if (created) {
      const trade = text(party.trade);
      push(out, {
        id: `party:${party.id}:added`,
        at: created,
        kind: 'people',
        sentence: trade ? `Added ${name} (${trade}) to the job` : `Added ${name} to the job`,
        actorName: name,
        actorEmail: member?.email ?? (text(party.email) || null),
        avatarUrl: member?.avatarUrl ?? null,
        live: false,
      });
    }
    const revoked = stamp(party.revoked_at);
    if (revoked) {
      push(out, {
        id: `party:${party.id}:removed`,
        at: revoked,
        kind: 'people',
        sentence: `Removed ${name} from the job`,
        actorName: name,
        actorEmail: member?.email ?? (text(party.email) || null),
        avatarUrl: member?.avatarUrl ?? null,
        live: false,
      });
    }
  }

  for (const item of record.scope) {
    const title = text(item.title);
    if (!title) continue;
    const created = stamp(item.created_at);
    if (created) {
      const line =
        item.state === 'excluded'
          ? `Marked “${title}” as out of scope`
          : `Added “${title}” to the scope`;
      push(out, {
        id: `scope:${item.id}`,
        at: created,
        kind: 'history',
        sentence: line,
        actorName: null,
        actorEmail: null,
        avatarUrl: null,
        live: false,
      });
    }
    const decided = stamp(item.decided_at);
    if (decided && (item.state === 'approved' || item.state === 'declined')) {
      push(out, {
        id: `scope:${item.id}:${item.state}`,
        at: decided,
        kind: 'history',
        sentence: item.state === 'approved' ? `Approved “${title}”` : `Declined “${title}”`,
        actorName: null,
        actorEmail: null,
        avatarUrl: null,
        live: false,
      });
    }
  }

  for (const revision of record.revisions ?? []) {
    const at = stamp(revision.createdAt);
    if (!at || revision.revision == null) continue;
    push(out, {
      id: `revision:${revision.revision}:${at}`,
      at,
      kind: 'history',
      sentence: `Published revision ${revision.revision} of the job file`,
      actorName: null,
      actorEmail: null,
      avatarUrl: null,
      live: false,
    });
  }

  const doc = source.scopeDoc;
  if (doc) {
    const uploaded = stamp(doc.createdAt);
    const name = text(doc.filename) || 'a scope document';
    if (uploaded) {
      push(out, {
        id: `scope-doc:${doc.id}`,
        at: uploaded,
        kind: 'history',
        sentence: `Uploaded scope document ${name}`,
        actorName: null,
        actorEmail: null,
        avatarUrl: null,
        live: false,
      });
    }
    const confirmed = stamp(doc.confirmedAt);
    if (confirmed && (!uploaded || !close(uploaded, confirmed, 60_000))) {
      push(out, {
        id: `scope-doc:${doc.id}:confirmed`,
        at: confirmed,
        kind: 'history',
        sentence: `Confirmed scope document ${name}`,
        actorName: null,
        actorEmail: null,
        avatarUrl: null,
        live: false,
      });
    }
  }
}

function liveSessions(source: TimelineSource, out: TimelineEvent[]) {
  for (const session of source.liveSessions) {
    if (session.status !== 'live') continue;
    const at = stamp(session.lastPartAt) ?? stamp(session.startedAt);
    if (!at) continue;
    const party = source.record?.parties.find((row) => row.id === session.partyId);
    const who = party ? partyName(party) : null;
    const member = who
      ? source.members.find((row) => text(row.fullName).toLowerCase() === who.toLowerCase())
      : null;
    push(out, {
      id: `live:session:${session.clipId}`,
      at,
      kind: 'clip',
      sentence: who ? `${who} is recording` : 'A clip is being recorded',
      actorName: who,
      actorEmail: member?.email ?? null,
      avatarUrl: member?.avatarUrl ?? null,
      live: true,
    });
  }
}

export function buildJobTimeline(source: TimelineSource): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  memoryEvents(source, out);
  clipEvents(source, out);
  custodyEvents(source, out);
  shareEvents(source, out);
  accessEvents(source, out);
  recordEvents(source, out);
  liveSessions(source, out);

  const seen = new Set<string>();
  const unique: TimelineEvent[] = [];
  for (const event of out) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.sentence && REDACTION_MARK.test(event.sentence)) continue;
    unique.push(event);
  }
  return unique;
}

export function filterTimeline(
  events: TimelineEvent[],
  filter: TimelineFilter,
  person: string,
): TimelineEvent[] {
  return events.filter((event) => {
    if (filter === 'live' && !event.live) return false;
    if (filter !== 'all' && filter !== 'live' && event.kind !== filter) return false;
    if (person && person !== 'all') {
      const name = event.actorName ?? '';
      if (name !== person) return false;
    }
    return true;
  });
}

export function orderTimeline(events: TimelineEvent[], oldestFirst: boolean): {
  live: TimelineEvent[];
  rest: TimelineEvent[];
} {
  const byTime = (a: TimelineEvent, b: TimelineEvent) => {
    const delta = Date.parse(a.at) - Date.parse(b.at);
    if (delta !== 0) return oldestFirst ? delta : -delta;
    return a.id.localeCompare(b.id);
  };
  const live = events.filter((event) => event.live).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const rest = events.filter((event) => !event.live).sort(byTime);
  return { live, rest };
}

export function groupTimelineDays(events: TimelineEvent[]): Array<{
  key: string;
  label: string;
  events: TimelineEvent[];
}> {
  const groups: Array<{ key: string; label: string; events: TimelineEvent[] }> = [];
  for (const event of events) {
    const key = ctDayKey(event.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.events.push(event);
      continue;
    }
    groups.push({ key, label: formatCtDay(event.at), events: [event] });
  }
  return groups;
}

/** A thumbnail may open the clip. It must not land inside a redacted range. */
export function timelineSeekTarget(event: TimelineEvent): number | null {
  const t = event.seekSeconds;
  if (t == null || !Number.isFinite(t) || t < 0) return null;
  const ranges = [
    ...(event.privacyRedactions?.ranges ?? []),
    ...(event.childPrivacyRedactions?.ranges ?? []),
  ];
  for (const range of ranges) {
    if (t >= range.startSec && t < range.endSec) return null;
    if (Math.abs(t - range.endSec) < 0.05) return null;
  }
  return t;
}

export function timelinePeople(events: TimelineEvent[]): string[] {
  const names = new Set<string>();
  for (const event of events) {
    const name = text(event.actorName);
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export const TIMELINE_FILTERS: Array<{ id: TimelineFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'job', label: 'Job' },
  { id: 'people', label: 'People' },
  { id: 'clip', label: 'Clips' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'share', label: 'Shares' },
  { id: 'custody', label: 'Custody' },
  { id: 'history', label: 'History' },
];
