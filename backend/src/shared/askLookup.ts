/**
 * Lookup tools for job-file and @mention Ask.
 *
 * The model searches for what it needs instead of receiving every transcript
 * in one prompt. Every transcript string returned here has passed through
 * redactTranscriptForAsk and redactTranscriptForChildPrivacy.
 *
 * Scope follows the Ask, not the model's arguments:
 * - a job-file Ask only sees that job (#560)
 * - org-wide Ask (no open job, office only) sees this org's jobs
 * - a progress-share viewer never leaves the open job
 * - another org's rows are dropped even if they were passed in
 */
import { transcriptLineCount } from './speechCount.js';
import {
  CHILD_PRIVACY_REDACTED_LABEL,
  childPrivacyRedactionsFromStored,
  redactTranscriptForChildPrivacy,
  secondsInChildPrivacyRange,
} from '../audio/childPrivacyRedactions.js';
import {
  PRIVACY_REDACTED_LABEL,
  privacyRedactionsFromStored,
  redactTranscriptForAsk,
  secondsInPrivacyRange,
} from '../audio/privacyRedactions.js';
import { cleanMentionTitle, mentionSpeakerLine, sourceSlug } from './mentions.js';
import {
  classifyAskIntent,
  classifyChatTurn,
  composeGroundedAsk,
  isJobOverview,
  localStamp,
  resolveAskQuestion,
  selectSpeechMoments,
} from './askPolish.js';
import {
  clipMatchesAskDate,
  formatAskClock,
  momentSourceId,
  parseAskClock,
  parseAskDate,
  type AskMomentQuote,
} from './askMoments.js';

export type AskLookupAccess = 'org' | 'viewer';

export type AskLookupTimed = { start: number; end: number; text: string };

export type AskLookupClip = {
  proofId: string;
  jobId: string;
  orgId: string;
  jobTitle?: string | null;
  title: string;
  workDate?: string | null;
  summary?: string | null;
  /** Raw transcript. Tools redact before anything is returned. */
  transcript?: string | null;
  segments?: AskLookupTimed[] | null;
  words?: AskLookupTimed[] | null;
  findings?: unknown;
  privacyRedactions?: unknown;
  childPrivacyRedactions?: unknown;
  /** Display names already on the clip, when the file identified them. */
  speakers?: string[] | null;
  recordedByUserIds?: string[] | null;
  /** When the clip was filmed. Ask's grounding check allows its local time. */
  capturedAt?: string | null;
};

export type AskLookupHistoryEvent = {
  id: string;
  jobId: string;
  orgId: string;
  summary: string;
  at?: string | null;
  actorId?: string | null;
};

export type AskLookupPerson = {
  userId: string;
  name: string;
  /** False when #560 kept them off the open job. */
  onThisJob: boolean;
  otherJobTitles?: string[] | null;
  recordedProofIds?: string[] | null;
  taggedProofIds?: string[] | null;
};

export type AskLookupCatalog = {
  orgId: string;
  /** Set on a job-file Ask. Null is org-wide office Ask. */
  jobId: string | null;
  access: AskLookupAccess;
  clips: AskLookupClip[];
  /**
   * Other jobs in this organization. Loaded only when the user asks, and never
   * searched by the open-job tools. Viewers do not receive these.
   */
  orgClips?: AskLookupClip[] | null;
  history?: AskLookupHistoryEvent[] | null;
  people?: AskLookupPerson[] | null;
  jobTitle?: string | null;
  /** Site address, when the job's property has one. */
  jobAddress?: string | null;
  /** Client or party contacts on the job. */
  clientName?: string | null;
  jobDescription?: string | null;
  /** Asker's IANA zone. History stamps use this, never UTC. */
  timeZone?: string | null;
};

export type AskLookupToolName =
  | 'search_transcripts'
  | 'search_other_jobs'
  | 'get_clip'
  | 'list_person_activity'
  | 'read_job_history';

export type AskLookupResult = {
  ok: boolean;
  tool: string;
  summary: string;
  data?: unknown;
};

export type AskLookupTraceStep = {
  tool: string;
  input: Record<string, unknown>;
  result: AskLookupResult;
};

type ToolDef = {
  name: AskLookupToolName;
  description: string;
  input_schema: Record<string, unknown>;
};

export const ASK_LOOKUP_TOOLS: ToolDef[] = [
  {
    name: 'search_transcripts',
    description:
      'Search redacted transcripts on this Ask\'s scope. Job-file Ask searches the open job only. Org-wide office Ask searches this organization\'s jobs. Returns clip ids, seek seconds, speaker, and a short verbatim excerpt. Does not return another organization\'s files.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to find in what was said.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_other_jobs',
    description:
      'Search redacted transcripts on other jobs in this organization. Use only when the user asks about other jobs, other files, or whether something was seen elsewhere. Does not search the open job and does not return another organization. Then call get_clip on a hit before you quote it.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to find on other jobs in this organization.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_clip',
    description:
      'Fetch one clip\'s full redacted transcript, findings, and speakers. proofId comes from search_transcripts or list_person_activity.',
    input_schema: {
      type: 'object',
      properties: {
        proofId: { type: 'string', description: 'Clip id from a previous tool result.' },
      },
      required: ['proofId'],
    },
  },
  {
    name: 'list_person_activity',
    description:
      'List what the file attributes to a person: clips they recorded, clips that only name them, and file actions. Someone not on the open job returns that fact and no clips from this job.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person named in the question.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'read_job_history',
    description: 'Read job history events on this Ask\'s scope. Does not include other organizations.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const ACTIVITY_VERBS = new Set(['done', 'filmed', 'recorded', 'opened', 'created', 'activity']);
const TASK_QUERY = new Set([
  'write', 'draft', 'summary', 'summarize', 'homeowner', 'client', 'customer', 'scope', 'note',
  'punch', 'punchlist', 'issues', 'issue', 'compare', 'visits', 'visit', 'prepare', 'compose',
  'list', 'open', 'make', 'two', 'both', 'three', 'these', 'those', 'each', 'between',
  'email', 'estimate', 'price', 'prices', 'bid',
]);

const STOP = new Set([
  'the', 'a', 'an', 'in', 'on', 'of', 'to', 'and', 'or', 'did', 'does', 'do', 'is', 'was',
  'are', 'were', 'this', 'that', 'it', 'any', 'what', 'when', 'where', 'how', 'who', 'why',
  'had', 'has', 'have', 'been', 'file', 'job', 'clip', 'clips', 'video', 'videos', 'say',
  'said', 'about', 'with', 'from', 'for', 'into', 'they', 'them', 'his', 'her', 'she', 'he',
]);

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
}

function asTimed(raw: unknown): AskLookupTimed[] {
  if (!Array.isArray(raw)) return [];
  const out: AskLookupTimed[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const start = Number(rec.start ?? rec.startSeconds ?? rec.startSec);
    const end = Number(rec.end ?? rec.endSeconds ?? rec.endSec ?? start);
    const text = trim(rec.text ?? rec.word);
    if (!Number.isFinite(start) || start < 0 || !text) continue;
    out.push({ start, end: Number.isFinite(end) ? end : start, text });
  }
  return out;
}

type TimedRange = { startSec: number; endSec: number };
type RedactionKind = 'clear' | 'privacy' | 'child';

/** True when any point of [start, end] sits in a stored range, including the inclusive end. */
function spanOverlaps(start: number, end: number, ranges: TimedRange[] | null | undefined): boolean {
  if (!ranges?.length) return false;
  const lo = Math.min(start, Number.isFinite(end) ? end : start);
  const hi = Math.max(lo, Number.isFinite(end) ? end : start);
  for (const range of ranges) {
    if (!Number.isFinite(range.startSec) || !Number.isFinite(range.endSec) || range.endSec < range.startSec) continue;
    if (hi >= range.startSec && lo < range.endSec) return true;
    if (Math.abs(lo - range.endSec) < 0.05 || Math.abs(hi - range.endSec) < 0.05) return true;
  }
  return false;
}

function redactionKind(start: number, end: number, privacy: TimedRange[], child: TimedRange[]): RedactionKind {
  if (spanOverlaps(start, end, child)) return 'child';
  if (spanOverlaps(start, end, privacy)) return 'privacy';
  return 'clear';
}

function labelFor(kind: RedactionKind): string | null {
  if (kind === 'child') return CHILD_PRIVACY_REDACTED_LABEL;
  if (kind === 'privacy') return PRIVACY_REDACTED_LABEL;
  return null;
}

/** A clock the line redactors will still treat as inside the range after rounding to a second. */
function stampFor(start: number, end: number, kind: RedactionKind, privacy: TimedRange[], child: TimedRange[]): number {
  if (kind === 'clear') return start;
  const ranges = kind === 'child' ? child : privacy;
  const hit = ranges.find((range) => spanOverlaps(start, end, [range]));
  if (!hit) return start;
  if (start >= hit.startSec && start < hit.endSec) return start;
  return hit.startSec;
}

/**
 * Group word timings into short lines. A word that overlaps a privacy or
 * child-privacy range never shares a line with speech outside that range,
 * and its text is replaced before the line is rendered.
 */
function linesFromWords(
  words: AskLookupTimed[],
  privacy: TimedRange[],
  child: TimedRange[],
): Array<{ start: number; text: string }> {
  const lines: Array<{ start: number; text: string }> = [];
  let current: { start: number; kind: RedactionKind; parts: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const label = labelFor(current.kind);
    lines.push({ start: current.start, text: label ?? current.parts.join(' ') });
    current = null;
  };
  for (const word of words) {
    const kind = redactionKind(word.start, word.end, privacy, child);
    const start = stampFor(word.start, word.end, kind, privacy, child);
    const tooLong = kind === 'clear' && current != null && current.parts.join(' ').length > 120;
    if (!current || kind !== current.kind || word.start - current.start > 4 || tooLong) {
      flush();
      current = { start, kind, parts: kind === 'clear' ? [word.text] : [] };
    } else if (kind === 'clear') {
      current.parts.push(word.text);
    }
  }
  flush();
  return lines;
}

function renderTimedLines(rows: AskLookupTimed[], privacy: TimedRange[], child: TimedRange[]): string {
  return rows
    .map((row) => {
      const kind = redactionKind(row.start, row.end, privacy, child);
      const text = labelFor(kind) ?? row.text;
      const start = stampFor(row.start, row.end, kind, privacy, child);
      return `[${formatAskClock(start)}] ${text}`;
    })
    .join('\n');
}

/**
 * Render segment or word clocks, then run both Ask redactors.
 * The returned text is the only transcript the tools may show.
 */
function redactAskText(text: string, clip: AskLookupClip): string {
  const privacy = privacyRedactionsFromStored(clip.privacyRedactions);
  const child = childPrivacyRedactionsFromStored(clip.childPrivacyRedactions);
  return trim(redactTranscriptForChildPrivacy(redactTranscriptForAsk(text, privacy), child));
}

export function redactClipTranscriptForAsk(clip: AskLookupClip): string {
  const privacy = privacyRedactionsFromStored(clip.privacyRedactions);
  const child = childPrivacyRedactionsFromStored(clip.childPrivacyRedactions);
  const segments = asTimed(clip.segments);
  const words = asTimed(clip.words);
  let rendered: string;
  if (segments.length) {
    rendered = renderTimedLines(segments, privacy, child);
  } else if (words.length) {
    rendered = linesFromWords(words, privacy, child)
      .map((line) => `[${formatAskClock(line.start)}] ${line.text}`)
      .join('\n');
  } else {
    rendered = trim(clip.transcript);
  }
  return redactAskText(rendered, clip);
}

function findingsText(findings: unknown, clip: AskLookupClip): string {
  if (!findings || typeof findings !== 'object') return '';
  const events = (findings as { events?: unknown }).events;
  if (!Array.isArray(events)) return '';
  const lines = events
    .map((event) => {
      if (!event || typeof event !== 'object') return '';
      const row = event as { text?: unknown; atSeconds?: unknown };
      const text = trim(row.text);
      if (!text) return '';
      const at = Number(row.atSeconds);
      return Number.isFinite(at) && at >= 0 ? `[${formatAskClock(at)}] ${text}` : text;
    })
    .filter(Boolean);
  if (!lines.length) return '';
  return redactAskText(lines.join('\n'), clip);
}

export type RedactedLine = { atSeconds: number | null; text: string; speaker: string | null };

export function redactedLines(transcript: string): RedactedLine[] {
  const rows: RedactedLine[] = [];
  for (const rawLine of transcript.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const clock = line.match(/^\[((?:\d+:)+\d+)\]\s*(.*)$/);
    const body = (clock ? clock[2] : line).trim();
    if (!body) continue;
    const speaker = body.match(/^([^:]{1,40}):\s+\S/);
    rows.push({
      atSeconds: clock ? parseAskClock(clock[1]!) : null,
      text: body,
      speaker: speaker ? speaker[1]!.trim() : null,
    });
  }
  return rows;
}

function speakerFor(clip: AskLookupClip, line: RedactedLine): string {
  if (line.speaker) return line.speaker;
  const named = (clip.speakers ?? []).map((name) => trim(name)).filter(Boolean);
  return named[0] || 'Speaker';
}

/** A visual label from the reading, not a person's name. */
export function isGenericSpeakerLabel(name: string): boolean {
  const text = name.trim();
  if (!text) return true;
  return /^(?:(?:seated|standing|walking)\s+)?(?:man|woman|person|guy|girl)$/i.test(text)
    || /^(?:person|speaker)\s*[a-d0-9]+$/i.test(text)
    || /^(?:speaker|unknown)$/i.test(text);
}

/** Prefer the person who recorded the clip over "Seated man" and similar labels. */
export function personNameForClip(catalog: AskLookupCatalog, clip: AskLookupClip, speaker: string): string {
  const raw = speaker.trim();
  if (raw && !isGenericSpeakerLabel(raw)) return raw;
  const named = (catalog.people ?? []).filter(
    (person) => person.name && !isGenericSpeakerLabel(person.name) && person.onThisJob !== false,
  );
  const recorded = new Set(clip.recordedByUserIds ?? []);
  const filmed = named.filter((person) => recorded.has(person.userId));
  if (filmed.length === 1) return filmed[0]!.name;
  // A contact can list the same proof without having filmed it. Do not let that
  // tie block the recorder, and do not guess when several people filmed it.
  if (recorded.size > 0) return raw || 'Speaker';
  const linked = named.filter((person) => (person.recordedProofIds ?? []).includes(clip.proofId));
  if (linked.length === 1) return linked[0]!.name;
  return raw || 'Speaker';
}

function isRedactedSpeech(text: string): boolean {
  return text.includes(PRIVACY_REDACTED_LABEL) || text.includes(CHILD_PRIVACY_REDACTED_LABEL);
}

function clipVisible(catalog: AskLookupCatalog, clip: AskLookupClip): boolean {
  if (clip.orgId !== catalog.orgId) return false;
  if (catalog.access === 'viewer') {
    return Boolean(catalog.jobId) && clip.jobId === catalog.jobId;
  }
  if (catalog.jobId) return clip.jobId === catalog.jobId;
  return true;
}

function proofIdsForPerson(clips: AskLookupClip[], userId: string, name: string): string[] {
  const needle = name.toLowerCase();
  return clips
    .filter((clip) => {
      if (userId && (clip.recordedByUserIds ?? []).includes(userId)) return true;
      return (clip.speakers ?? []).some((speaker) => trim(speaker).toLowerCase() === needle);
    })
    .map((clip) => clip.proofId);
}

/**
 * People for every Ask turn: @mentions when the question has them, plus crew,
 * party contacts, and clip speakers already on the job.
 * An off-job mention stays off this job and does not pick up its clips.
 */
export function mergeJobAskPeople(input: {
  mentioned?: AskLookupPerson[] | null;
  crew?: Array<{ userId?: string | null; name?: string | null }> | null;
  contacts?: Array<{ userId?: string | null; name?: string | null; proofIds?: string[] | null }> | null;
  clips?: AskLookupClip[] | null;
}): AskLookupPerson[] {
  const clips = input.clips ?? [];
  const people: AskLookupPerson[] = (input.mentioned ?? []).map((person) => ({ ...person }));
  const known = (name: string, userId?: string | null) =>
    people.some(
      (person) =>
        (userId && person.userId === userId) ||
        (name && person.name.toLowerCase() === name.toLowerCase()),
    );
  const add = (person: AskLookupPerson) => {
    if (!trim(person.name) || !trim(person.userId) || known(person.name, person.userId)) return;
    people.push(person);
  };

  for (const row of input.crew ?? []) {
    const name = trim(row.name);
    const userId = trim(row.userId);
    if (!name || !userId) continue;
    add({
      userId,
      name,
      onThisJob: true,
      recordedProofIds: proofIdsForPerson(clips, userId, name),
      taggedProofIds: [],
    });
  }
  for (const row of input.contacts ?? []) {
    const name = trim(row.name);
    if (!name) continue;
    const userId = trim(row.userId) || `contact:${name.toLowerCase()}`;
    const listed = (row.proofIds ?? []).map((id) => trim(id)).filter(Boolean);
    add({
      userId,
      name,
      onThisJob: true,
      recordedProofIds: listed.length ? listed : proofIdsForPerson(clips, userId, name),
      taggedProofIds: [],
    });
  }
  for (const clip of clips) {
    for (const speaker of clip.speakers ?? []) {
      const name = trim(speaker);
      if (!name || isGenericSpeakerLabel(name)) continue;
      add({
        userId: `speaker:${name.toLowerCase()}`,
        name,
        onThisJob: true,
        recordedProofIds: proofIdsForPerson(clips, '', name),
        taggedProofIds: [],
      });
    }
  }

  return people.map((person) => {
    if (person.onThisJob === false) return person;
    const recorded = (person.recordedProofIds ?? []).map((id) => trim(id)).filter(Boolean);
    if (recorded.length) return { ...person, recordedProofIds: recorded };
    const filled = proofIdsForPerson(clips, person.userId, person.name);
    return filled.length ? { ...person, recordedProofIds: filled } : person;
  });
}

export function lookupPeopleFromContexts(
  people: Array<{
    userId: string;
    name: string;
    /** False when mention prep already decided they are not on the open job. */
    onThisJob?: boolean;
    otherJobTitles?: string[] | null;
    items?: Array<{ kind?: string; proofId?: string | null; captured?: boolean }> | null;
  }>,
): AskLookupPerson[] {
  return people
    .filter((person) => person.userId && person.name)
    .map((person) => {
      const items = person.items ?? [];
      const elsewhere = (person.otherJobTitles ?? []).map((title) => trim(title)).filter(Boolean);
      return {
        userId: person.userId,
        name: person.name,
        onThisJob: person.onThisJob !== false,
        ...(elsewhere.length ? { otherJobTitles: elsewhere } : {}),
        recordedProofIds: items
          .filter((item) => item.kind === 'video' && item.captured && item.proofId)
          .map((item) => String(item.proofId)),
        taggedProofIds: items
          .filter((item) => item.kind === 'video' && !item.captured && item.proofId)
          .map((item) => String(item.proofId)),
      };
    });
}

export function clipFromProofRow(
  row: Record<string, unknown>,
  input: { orgId: string; jobId: string; partyCreatedBy?: string | null; jobTitle?: string | null },
): AskLookupClip {
  const findings =
    row.ai_findings && typeof row.ai_findings === 'object'
      ? (row.ai_findings as Record<string, unknown>)
      : {};
  const device =
    row.device_metadata && typeof row.device_metadata === 'object'
      ? (row.device_metadata as Record<string, unknown>)
      : {};
  const recorded = [input.partyCreatedBy, device.userId].map((value) => trim(value)).filter(Boolean);
  const speakers = mentionSpeakerLine(findings)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  return {
    proofId: String(row.id ?? ''),
    jobId: String(row.job_id ?? input.jobId),
    orgId: String(row.org_id ?? input.orgId),
    jobTitle: input.jobTitle ?? null,
    title: String(row.title || 'Clip'),
    workDate: row.work_date ? String(row.work_date) : null,
    summary: trim(row.ai_summary ?? row.narration_text) || null,
    transcript: row.transcript_text == null ? null : String(row.transcript_text),
    segments: asTimed(row.transcript_segments),
    words: asTimed(row.transcript_words),
    findings,
    privacyRedactions: findings.privacyRedactions,
    childPrivacyRedactions: findings.childPrivacyRedactions,
    speakers,
    recordedByUserIds: [...new Set(recorded)],
    capturedAt: row.captured_at ? String(row.captured_at) : null,
  };
}

export function askLookupCatalogFromJob(input: {
  orgId: string;
  jobId: string;
  access: AskLookupAccess;
  proofs: Array<Record<string, unknown>>;
  parties?: Array<{ id?: string | null; created_by?: string | null }> | null;
  history?: Array<Record<string, unknown>> | null;
  jobTitle?: string | null;
  jobAddress?: string | null;
  clientName?: string | null;
  jobDescription?: string | null;
  people?: AskLookupPerson[] | null;
  timeZone?: string | null;
  orgClips?: AskLookupClip[] | null;
}): AskLookupCatalog {
  const partyById = new Map((input.parties ?? []).map((party) => [String(party.id ?? ''), party.created_by ?? null]));
  return {
    orgId: input.orgId,
    jobId: input.access === 'viewer' || input.jobId ? input.jobId : null,
    access: input.access,
    jobTitle: input.jobTitle ?? null,
    jobAddress: trim(input.jobAddress) || null,
    clientName: trim(input.clientName) || null,
    jobDescription: trim(input.jobDescription) || null,
    timeZone: input.timeZone ?? null,
    people: input.people ?? [],
    orgClips: input.orgClips ?? undefined,
    clips: input.proofs
      .filter((row) => !row.deleted_at)
      .map((row) =>
        clipFromProofRow(row, {
          orgId: input.orgId,
          jobId: input.jobId,
          jobTitle: input.jobTitle,
          partyCreatedBy: partyById.get(String(row.party_id ?? '')) ?? null,
        }),
      )
      .filter((clip) => clip.proofId),
    history: (input.history ?? [])
      .map((event) => ({
        id: String(event.id ?? ''),
        jobId: String(event.job_id ?? input.jobId),
        orgId: String(event.org_id ?? input.orgId),
        summary: trim(event.summary),
        at: event.occurred_at ? String(event.occurred_at) : null,
        actorId: event.actor_id ? String(event.actor_id) : null,
      }))
      .filter((event) => event.summary),
  };
}

export function clipsInScope(catalog: AskLookupCatalog): AskLookupClip[] {
  return catalog.clips.filter((clip) => clipVisible(catalog, clip));
}

const OTHER_JOB_NOISE = new Set([
  'other', 'jobs', 'job', 'seen', 'done', 'elsewhere', 'across', 'organization',
  'company', 'files', 'file', 'have', 'rest', 'this', 'that',
]);

/** True when the user asked to look past the open job. Office only. */
export function asksAboutOtherJobs(question: string): boolean {
  return /\b(other jobs?|another job|across (?:the |our )?(?:org|organization|company)|elsewhere|rest of (?:the )?(?:org|jobs)|have we (?:seen|done)|on other files)\b/i.test(
    question,
  );
}

function orgClipsVisible(catalog: AskLookupCatalog): AskLookupClip[] {
  if (catalog.access === 'viewer') return [];
  return (catalog.orgClips ?? []).filter(
    (clip) => clip.orgId === catalog.orgId && Boolean(clip.jobId) && clip.jobId !== catalog.jobId,
  );
}

function otherJobNeedles(query: string): string[] {
  return tokens(query).filter((word) => !OTHER_JOB_NOISE.has(word) && word.length > 3);
}

function historyInScope(catalog: AskLookupCatalog): AskLookupHistoryEvent[] {
  return (catalog.history ?? []).filter((event) => {
    if (event.orgId !== catalog.orgId) return false;
    if (catalog.access === 'viewer') return Boolean(catalog.jobId) && event.jobId === catalog.jobId;
    if (catalog.jobId) return event.jobId === catalog.jobId;
    return true;
  });
}

function citeFor(clip: AskLookupClip, atSeconds: number | null): string {
  return momentSourceId(clip.jobId, clip.proofId, sourceSlug(clip.title), atSeconds);
}

/** Prefer the segment or word start that produced a redacted line's clock. */
function preciseMoment(clip: AskLookupClip, atSeconds: number | null): number | null {
  if (atSeconds == null) return null;
  const pool = [...asTimed(clip.words), ...asTimed(clip.segments)];
  let best: number | null = null;
  let dist = 0.75;
  for (const row of pool) {
    if (spanIsRedacted(clip, row.start, row.end)) continue;
    const next = Math.abs(row.start - atSeconds);
    if (next < dist) {
      best = row.start;
      dist = next;
    }
  }
  return best ?? atSeconds;
}

export type AskSpeechMoment = {
  excerpt: string;
  speaker: string;
  atSeconds: number | null;
  cite: string;
};

function clipMoments(clip: AskLookupClip): AskSpeechMoment[] {
  const privacy = privacyRedactionsFromStored(clip.privacyRedactions);
  const child = childPrivacyRedactionsFromStored(clip.childPrivacyRedactions);
  const segments = asTimed(clip.segments);
  const words = asTimed(clip.words);
  const timed: Array<{ start: number | null; text: string }> = segments.length
    ? segments.map((row) => {
        const kind = redactionKind(row.start, row.end, privacy, child);
        return {
          start: kind === 'clear' ? row.start : stampFor(row.start, row.end, kind, privacy, child),
          text: labelFor(kind) ?? row.text,
        };
      })
    : words.length
      ? linesFromWords(words, privacy, child).map((line) => ({ start: line.start, text: line.text }))
      : redactedLines(redactClipTranscriptForAsk(clip)).map((line) => ({
          start: line.atSeconds,
          text: line.text,
        }));
  return timed
    .filter((row) => row.text && !isRedactedSpeech(row.text))
    .map((row) => {
      const text = row.text.replace(/^[^:]{1,40}:\s+/, '');
      const atSeconds = row.start;
      const speaker = speakerFor(clip, { atSeconds, text: row.text, speaker: null });
      return {
        excerpt: excerpt(text),
        speaker,
        atSeconds,
        cite: citeFor(clip, atSeconds),
      };
    });
}

/** First real timed moment. Skip a 0:00 opener when a later word or segment exists. */
function representativeAt(clip: AskLookupClip): number | null {
  const times = clipMoments(clip)
    .map((moment) => moment.atSeconds)
    .filter((at): at is number => at != null);
  return times.find((at) => at >= 0.5) ?? times[0] ?? null;
}

function clipHasClearSpeech(clip: AskLookupClip): boolean {
  return clipMoments(clip).some((moment) => moment.excerpt);
}

function clipsForPerson(catalog: AskLookupCatalog, person: AskLookupPerson): AskLookupClip[] {
  const recorded = new Set(person.recordedProofIds ?? []);
  const tagged = new Set(person.taggedProofIds ?? []);
  const explicitLists = person.recordedProofIds != null || person.taggedProofIds != null;
  return clipsInScope(catalog).filter((clip) => {
    if (recorded.has(clip.proofId) || tagged.has(clip.proofId)) return true;
    if (explicitLists) return false;
    return (clip.recordedByUserIds ?? []).includes(person.userId);
  });
}

function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 160) return clean;
  return `${clean.slice(0, 157).trim()}…`;
}

function lineMatches(query: string, line: string): boolean {
  const hay = line.toLowerCase();
  if (hay.includes(query.toLowerCase())) return true;
  const words = tokens(query);
  if (!words.length) return false;
  const hits = words.filter((word) => hay.includes(word));
  return hits.length >= Math.min(2, words.length) || (words.length === 1 && hits.length === 1);
}

export function searchTranscripts(catalog: AskLookupCatalog, query: string): AskLookupResult {
  const needle = trim(query).slice(0, 300);
  if (!needle) return { ok: false, tool: 'search_transcripts', summary: 'Missing search query.' };
  const hits: Array<Record<string, unknown>> = [];
  for (const clip of clipsInScope(catalog)) {
    const transcript = redactClipTranscriptForAsk(clip);
    for (const line of redactedLines(transcript)) {
      if (
        line.text === PRIVACY_REDACTED_LABEL ||
        line.text.endsWith(PRIVACY_REDACTED_LABEL) ||
        line.text.includes(CHILD_PRIVACY_REDACTED_LABEL)
      ) {
        continue;
      }
      if (!lineMatches(needle, line.text)) continue;
      const speaker = personNameForClip(catalog, clip, speakerFor(clip, line));
      const atSeconds = preciseMoment(clip, line.atSeconds);
      hits.push({
        proofId: clip.proofId,
        jobId: clip.jobId,
        jobTitle: clip.jobTitle ?? null,
        title: clip.title,
        workDate: clip.workDate ?? null,
        atSeconds,
        speaker,
        excerpt: excerpt(line.text.replace(/^[^:]{1,40}:\s+/, '')),
        cite: citeFor(clip, atSeconds),
      });
      if (hits.length >= 8) break;
    }
    if (hits.length >= 8) break;
  }
  return {
    ok: true,
    tool: 'search_transcripts',
    summary: hits.length
      ? `Found ${hits.length} transcript moment(s) in scope.`
      : `No transcript on this ${catalog.jobId ? 'job' : 'organization'} matches that.`,
    data: { query: needle, hits },
  };
}

export function searchOtherJobs(catalog: AskLookupCatalog, query: string): AskLookupResult {
  if (catalog.access === 'viewer') {
    return { ok: false, tool: 'search_other_jobs', summary: 'This share can only read the open job.' };
  }
  const needle = trim(query).slice(0, 300);
  const pool = orgClipsVisible(catalog);
  if (!pool.length) {
    return {
      ok: true,
      tool: 'search_other_jobs',
      summary: 'No other jobs in this organization are loaded.',
      data: { query: needle, hits: [] },
    };
  }
  const needles = otherJobNeedles(needle);
  const hits: Array<Record<string, unknown>> = [];
  for (const clip of pool) {
    const transcript = redactClipTranscriptForAsk(clip);
    const summary = redactedClipSummary(clip);
    const lines = redactedLines(transcript).filter((line) => {
      if (!line.text || isRedactedSpeech(line.text) || line.text.endsWith(PRIVACY_REDACTED_LABEL)) return false;
      if (needle && lineMatches(needle, line.text)) return true;
      const hay = line.text.toLowerCase();
      return needles.some((word) => hay.includes(word));
    });
    const blob = `${clip.title}\n${summary}`.toLowerCase();
    const titleHit = needles.some((word) => blob.includes(word));
    const rows = lines.length
      ? lines
      : titleHit
        ? [{ atSeconds: null, text: summary || clip.title, speaker: null }]
        : [];
    for (const line of rows) {
      if (!line.text || isRedactedSpeech(line.text)) continue;
      const speaker = personNameForClip(catalog, clip, speakerFor(clip, line));
      const atSeconds = preciseMoment(clip, line.atSeconds);
      hits.push({
        proofId: clip.proofId,
        jobId: clip.jobId,
        jobTitle: clip.jobTitle ?? null,
        title: clip.title,
        workDate: clip.workDate ?? null,
        atSeconds,
        speaker,
        excerpt: excerpt(line.text.replace(/^[^:]{1,40}:\s+/, '')),
        cite: citeFor(clip, atSeconds),
      });
      if (hits.length >= 8) break;
    }
    if (hits.length >= 8) break;
  }
  return {
    ok: true,
    tool: 'search_other_jobs',
    summary: hits.length
      ? `Found ${hits.length} moment(s) on other jobs in this organization.`
      : 'Nothing on the other jobs in this organization matches that.',
    data: { query: needle, hits },
  };
}

export function getClip(catalog: AskLookupCatalog, proofId: string): AskLookupResult {
  const id = trim(proofId);
  const inScope = clipsInScope(catalog).find((row) => row.proofId === id);
  const elsewhere = !inScope ? orgClipsVisible(catalog).find((row) => row.proofId === id) : null;
  const clip = inScope ?? elsewhere ?? null;
  if (!clip) {
    return {
      ok: false,
      tool: 'get_clip',
      summary: catalog.jobId
        ? 'That clip is not on this job.'
        : 'That clip is not in this organization.',
    };
  }
  const transcript = redactClipTranscriptForAsk(clip);
  const findings = findingsText(clip.findings, clip);
  const moments = clipMoments(clip).map((moment) => ({
    ...moment,
    speaker: personNameForClip(catalog, clip, moment.speaker),
  }));
  const atSeconds = representativeAt(clip);
  const where = elsewhere ? ` from ${trim(clip.jobTitle) || 'another job'}` : '';
  return {
    ok: true,
    tool: 'get_clip',
    summary: `Loaded ${clip.title}${where}.`,
    data: {
      proofId: clip.proofId,
      jobId: clip.jobId,
      jobTitle: clip.jobTitle ?? null,
      title: clip.title,
      workDate: clip.workDate ?? null,
      summary: redactedClipSummary(clip) || null,
      speakers: [...new Set((clip.speakers ?? []).map((name) => personNameForClip(catalog, clip, name)).filter(Boolean))],
      cite: citeFor(clip, atSeconds),
      atSeconds,
      transcript: transcript || null,
      findings: findings || null,
      moments,
    },
  };
}

function personByName(catalog: AskLookupCatalog, name: string): AskLookupPerson | null {
  const needle = trim(name).toLowerCase().replace(/^@/, '');
  if (!needle) return null;
  const people = catalog.people ?? [];
  const exact = people.find((person) => person.name.toLowerCase() === needle);
  if (exact) return exact;
  return (
    people.find((person) => person.name.toLowerCase().includes(needle) || needle.includes(person.name.toLowerCase())) ??
    null
  );
}

export function listPersonActivity(catalog: AskLookupCatalog, name: string): AskLookupResult {
  const person = personByName(catalog, name);
  if (!person) {
    return {
      ok: true,
      tool: 'list_person_activity',
      summary: `No one in this organization matches “${trim(name).slice(0, 80)}”.`,
      data: { name: trim(name), matched: false, clips: [], actions: [] },
    };
  }
  if (catalog.jobId && !person.onThisJob) {
    const elsewhere = (person.otherJobTitles ?? []).filter(Boolean);
    return {
      ok: true,
      tool: 'list_person_activity',
      summary: elsewhere.length
        ? `${person.name} isn't on this job. They are on ${elsewhere.join(', ')}.`
        : `${person.name} isn't on this job.`,
      data: {
        name: person.name,
        userId: person.userId,
        onThisJob: false,
        otherJobTitles: elsewhere,
        clips: [],
        actions: [],
      },
    };
  }
  const recorded = new Set(person.recordedProofIds ?? []);
  const clips = clipsForPerson(catalog, person)
    .map((clip) => {
      const moments = clipMoments(clip).map((moment) => ({
        ...moment,
        speaker: personNameForClip(catalog, clip, moment.speaker),
      }));
      const atSeconds = representativeAt(clip);
      const spoken = moments.find((moment) => moment.atSeconds === atSeconds) ?? moments[0];
      return {
        proofId: clip.proofId,
        jobId: clip.jobId,
        jobTitle: clip.jobTitle ?? null,
        title: clip.title,
        workDate: clip.workDate ?? null,
        recorded: recorded.has(clip.proofId) || (clip.recordedByUserIds ?? []).includes(person.userId),
        summary: redactedClipSummary(clip) || null,
        cite: spoken?.cite ?? citeFor(clip, atSeconds),
        atSeconds: spoken?.atSeconds ?? atSeconds,
        speaker: spoken?.speaker ?? null,
        excerpt: spoken?.excerpt ?? null,
      };
    });
  const actions = historyInScope(catalog)
    .filter((event) => event.actorId === person.userId)
    .map((event) => ({ at: localStamp(event.at, catalog.timeZone) || null, summary: event.summary }));
  return {
    ok: true,
    tool: 'list_person_activity',
    summary: clips.length
      ? `${person.name} has ${clips.length} clip(s) on this ${catalog.jobId ? 'job' : 'organization'}.`
      : `Nothing on this ${catalog.jobId ? 'job' : 'organization'} was recorded by ${person.name}.`,
    data: { name: person.name, userId: person.userId, onThisJob: person.onThisJob, clips, actions },
  };
}

export function readJobHistory(catalog: AskLookupCatalog): AskLookupResult {
  const events = historyInScope(catalog).map((event) => ({
    at: localStamp(event.at, catalog.timeZone) || null,
    summary: event.summary,
    jobId: event.jobId,
  }));
  return {
    ok: true,
    tool: 'read_job_history',
    summary: events.length ? `Job history has ${events.length} event(s) in scope.` : 'Job history has nothing in scope.',
    data: { events },
  };
}

export function executeAskLookup(
  name: string,
  rawInput: Record<string, unknown> | undefined,
  catalog: AskLookupCatalog,
): AskLookupResult {
  const input = rawInput ?? {};
  // A model argument cannot widen #560 scope. jobId on the call is ignored
  // unless it is exactly the open job (or any in-org job when the Ask is org-wide).
  const requestedJob = trim(input.jobId);
  if (requestedJob && catalog.jobId && requestedJob !== catalog.jobId) {
    return {
      ok: false,
      tool: name,
      summary: 'This Ask is limited to the open job.',
    };
  }
  if (requestedJob && catalog.access === 'viewer' && requestedJob !== catalog.jobId) {
    return {
      ok: false,
      tool: name,
      summary: 'This share can only read the open job.',
    };
  }
  switch (name as AskLookupToolName) {
    case 'search_transcripts':
      return searchTranscripts(catalog, trim(input.query) || trim(input.q));
    case 'search_other_jobs':
      return searchOtherJobs(catalog, trim(input.query) || trim(input.q));
    case 'get_clip':
      return getClip(catalog, trim(input.proofId) || trim(input.id));
    case 'list_person_activity':
      return listPersonActivity(catalog, trim(input.name) || trim(input.person));
    case 'read_job_history':
      return readJobHistory(catalog);
    default:
      return { ok: false, tool: name, summary: `Unknown lookup tool: ${name}` };
  }
}

export function clipIndex(catalog: AskLookupCatalog): string {
  const lines = clipsInScope(catalog).map((clip) => {
    const when = clip.workDate ? ` ${clip.workDate}` : '';
    return `- ${clip.proofId} | ${clip.title}${when} | cite ${citeFor(clip, null)}`;
  });
  return lines.length ? lines.join('\n') : '- none';
}

/** Redacted transcript, findings, and summary for one clip. Safe to put in a prompt or a stored answer. */
export function clipAskPreview(clip: AskLookupClip): { transcript: string; findings: string; summary: string } {
  return {
    transcript: redactClipTranscriptForAsk(clip).slice(0, 900),
    findings: findingsText(clip.findings, clip).slice(0, 400),
    summary: redactedClipSummary(clip).slice(0, 400),
  };
}

function keepRedactedPhrase(text: string): boolean {
  return text.length >= 12 || (text.length >= 4 && /\d{3,}/.test(text));
}

/** Phrases that overlap a privacy or child-privacy range. These must not be stored or replayed. */
export function redactedSourcePhrases(clip: AskLookupClip): string[] {
  const phrases: string[] = [];
  const push = (text: string) => {
    const clean = trim(text).replace(/^\[[^\]]+\]\s*/, '');
    if (keepRedactedPhrase(clean)) phrases.push(clean);
  };
  const timed = [...asTimed(clip.segments), ...asTimed(clip.words)];
  for (const row of timed) {
    if (!spanIsRedacted(clip, row.start, row.end)) continue;
    push(row.text);
  }
  const privacy = privacyRedactionsFromStored(clip.privacyRedactions);
  const child = childPrivacyRedactionsFromStored(clip.childPrivacyRedactions);
  if (!timed.length && (privacy.length || child.length)) {
    for (const piece of trim(clip.transcript).split(/\n+|(?<=[.!?])\s+/)) push(piece);
  }
  return phrases;
}

/** Summary safe to put in a prompt, an overview, or a stored answer. */
export function redactedClipSummary(clip: AskLookupClip): string {
  return scrubStoredAskText(redactAskText(trim(clip.summary), clip), [clip]);
}

/** Replace redacted transcript phrases before an answer is stored or sent back as memory. */
export function scrubStoredAskText(text: string, clips: AskLookupClip[] | null | undefined): string {
  let out = String(text ?? '');
  const sorted = (clips ?? [])
    .flatMap((clip) => redactedSourcePhrases(clip))
    .sort((a, b) => b.length - a.length);
  for (const phrase of sorted) {
    if (!phrase || !out.includes(phrase)) continue;
    out = out.split(phrase).join('[privacy redacted]');
  }
  return out;
}

/**
 * Cap for the stable job block. Small files stay whole. Larger files keep
 * every clip's date, title, and summary, then as many redacted transcripts
 * as fit, in catalog order so the cached prefix does not change per question.
 */
export const ASK_CONTEXT_BUDGET = 14_000;

function rawTranscriptLine(clip: AskLookupClip, preview: string): string {
  if (!preview) return '  Raw transcript (authoritative): none';
  const count = transcriptLineCount(redactClipTranscriptForAsk(clip));
  return `  Raw transcript (authoritative, ${count} line${count === 1 ? '' : 's'}): ${preview}`;
}

function renderClipCard(clip: AskLookupClip, catalog: AskLookupCatalog, withTranscript: boolean): string {
  const when = clip.workDate ? localStamp(clip.workDate, catalog.timeZone) || clip.workDate : 'Undated';
  const preview = clipAskPreview(clip);
  const summary = trim(preview.summary);
  // The raw transcript is the authority on what was said and how much; the AI
  // summary can be older than the transcript. Transcript first, labeled so.
  return [
    `- ${when} — ${clip.title}`,
    withTranscript ? rawTranscriptLine(clip, preview.transcript) : '',
    summary ? `  AI summary (may be stale; not a source for what was said): ${summary}` : '',
    preview.findings ? `  Findings: ${preview.findings}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Project, address, client, people, history, and every clip's redacted transcript. */
export function formatAskJobContext(catalog: AskLookupCatalog): string {
  const lines: string[] = [];
  lines.push(`Project: ${trim(catalog.jobTitle) || 'Untitled job'}`);
  if (trim(catalog.jobAddress)) lines.push(`Address: ${trim(catalog.jobAddress)}`);
  if (trim(catalog.clientName)) lines.push(`Client: ${trim(catalog.clientName)}`);
  if (trim(catalog.jobDescription)) lines.push(`Description: ${trim(catalog.jobDescription)}`);
  const people = (catalog.people ?? []).filter((person) => person.onThisJob !== false && trim(person.name));
  lines.push(people.length ? `People: ${people.map((person) => person.name).join(', ')}` : 'People: none listed');
  const history = (catalog.history ?? []).slice(0, 12);
  lines.push(
    history.length
      ? `Job history:\n${history
          .map((event) => `- ${localStamp(event.at, catalog.timeZone) || 'Recorded'}: ${event.summary}`)
          .join('\n')}`
      : 'Job history: none',
  );
  const clips = clipsInScope(catalog);
  if (!clips.length) {
    lines.push('Clips: none');
    return lines.join('\n');
  }
  const fullCards = clips.map((clip) => renderClipCard(clip, catalog, true));
  const full = [...lines, `Clips:\n${fullCards.join('\n')}`].join('\n');
  if (full.length <= ASK_CONTEXT_BUDGET) return full;

  const compactCards = clips.map((clip) => renderClipCard(clip, catalog, false));
  let packed = [...lines, `Clips:\n${compactCards.join('\n')}`].join('\n');
  for (const clip of clips) {
    const transcript = clipAskPreview(clip).transcript;
    if (!transcript) continue;
    const count = transcriptLineCount(redactClipTranscriptForAsk(clip));
    const line = `\n  Raw transcript, authoritative (${clip.title}, ${count} line${count === 1 ? '' : 's'}): ${transcript}`;
    if (packed.length + line.length > ASK_CONTEXT_BUDGET) break;
    packed += line;
  }
  return packed.slice(0, ASK_CONTEXT_BUDGET);
}

export type LookupPromptInput = {
  question: string;
  catalog: AskLookupCatalog;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  /** When a short follow-up was rewritten from the thread. */
  resolved?: string | null;
  extra?: string | null;
};

function lookupPromptSections(input: LookupPromptInput): {
  scope: string;
  context: string;
  extra: string;
  turns: string;
  follow: string;
  question: string;
} {
  const turns = (input.history ?? [])
    .filter((turn) => trim(turn.text))
    .slice(-8)
    .map((turn) => {
      const who = turn.role === 'assistant' ? 'Assistant' : 'User';
      const text = scrubStoredAskText(trim(turn.text), input.catalog.clips).slice(0, 1500);
      return `${who}: ${text}`;
    })
    .join('\n');
  const resolved = trim(input.resolved);
  const askedElsewhere = asksAboutOtherJobs(input.question) || asksAboutOtherJobs(resolved);
  const scope = input.catalog.jobId
    ? askedElsewhere
      ? `Open job ${input.catalog.jobId}. The user asked about other jobs in this organization. Call search_other_jobs, then get_clip on those clips. Do not invent other jobs.`
      : `Open job ${input.catalog.jobId}. Do not search other jobs unless the user asks.`
    : 'Org-wide office Ask. Stay inside this organization.';
  const follow =
    resolved && resolved.toLowerCase() !== input.question.trim().toLowerCase()
      ? `This follow-up refers to: ${resolved}`
      : '';
  return {
    scope,
    context: `Job context:\n${formatAskJobContext(input.catalog)}`,
    extra: input.extra?.trim() ? input.extra.trim() : '',
    turns: turns ? `Earlier turns in this chat (questions, answers, and the clips they cited):\n${turns}` : '',
    follow,
    question: `Question: ${input.question}`,
  };
}

/**
 * Stable job context (cached) and the volatile turn (question, thread, memory).
 * The stable block does not include the question, so repeat questions on the
 * same file share a cache prefix.
 */
export function splitLookupPrompt(input: LookupPromptInput): { stable: string; volatile: string } {
  const parts = lookupPromptSections(input);
  return {
    stable: parts.context,
    volatile: [parts.scope, parts.extra, parts.turns, parts.follow, parts.question].filter(Boolean).join('\n\n'),
  };
}

/** Titles, redacted transcripts, and the prior thread. Secrets in older turns are scrubbed. */
export function buildLookupUserPrompt(input: LookupPromptInput): string {
  const parts = lookupPromptSections(input);
  return [parts.scope, parts.context, parts.extra, parts.turns, parts.follow, parts.question]
    .filter(Boolean)
    .join('\n\n');
}

const SPEECH_QUESTION = /\b(say|said|quote|tell|mention)\b/i;

function dedupePlan(
  steps: Array<{ name: AskLookupToolName; input: Record<string, unknown> }>,
): Array<{ name: AskLookupToolName; input: Record<string, unknown> }> {
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = `${step.name}:${JSON.stringify(step.input)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

export function planAskLookup(
  question: string,
  catalog: AskLookupCatalog,
  history?: Array<{ role?: string | null; text?: string | null }> | null,
): Array<{ name: AskLookupToolName; input: Record<string, unknown> }> {
  const resolved = resolveAskQuestion(question, history, catalog);
  const chat = classifyChatTurn(resolved, history, catalog);
  if (chat === 'correction') {
    return clipsInScope(catalog)
      .slice(0, 3)
      .map((clip) => ({ name: 'get_clip' as const, input: { proofId: clip.proofId } }));
  }
  if (chat) return [];
  if (isJobOverview(resolved)) {
    const steps: Array<{ name: AskLookupToolName; input: Record<string, unknown> }> = [
      { name: 'read_job_history', input: {} },
    ];
    for (const clip of clipsInScope(catalog).slice(0, 8)) {
      steps.push({ name: 'get_clip', input: { proofId: clip.proofId } });
    }
    return steps;
  }
  const steps: Array<{ name: AskLookupToolName; input: Record<string, unknown> }> = [];
  const q = resolved.toLowerCase();
  const person = (catalog.people ?? []).find((row) => resolved.toLowerCase().includes(row.name.toLowerCase()));
  if (person) steps.push({ name: 'list_person_activity', input: { name: person.name } });
  const asked = parseAskDate(resolved);
  if (SPEECH_QUESTION.test(resolved) && asked) {
    const pool = person ? clipsForPerson(catalog, person) : clipsInScope(catalog);
    const dated = pool.filter((clip) => clipMatchesAskDate(clip.workDate, asked, catalog.timeZone));
    const rest = pool.filter((clip) => !dated.includes(clip) && clipHasClearSpeech(clip));
    for (const clip of [...dated, ...rest]) {
      if (steps.filter((step) => step.name === 'get_clip').length >= 3) break;
      steps.push({ name: 'get_clip', input: { proofId: clip.proofId } });
    }
    return dedupePlan(steps);
  }
  const query = tokens(resolved)
    .filter((token) => !person || !person.name.toLowerCase().includes(token))
    .filter((token) => !ACTIVITY_VERBS.has(token) && !TASK_QUERY.has(token) && !/^\d+$/.test(token))
    .slice(0, 6)
    .join(' ');
  if (query) steps.push({ name: 'search_transcripts', input: { query } });
  const titled = clipsInScope(catalog).find((clip) => {
    const words = tokens(clip.title);
    return words.some((word) => q.includes(word));
  });
  if (titled) steps.push({ name: 'get_clip', input: { proofId: titled.proofId } });
  if (/\b(done|history|file|activity|opened|created)\b/.test(q) || classifyAskIntent(resolved).kind === 'task') {
    steps.push({ name: 'read_job_history', input: {} });
  }
  if (classifyAskIntent(resolved).kind === 'task' && !person) {
    for (const row of clipsInScope(catalog).slice(0, 3)) {
      steps.push({ name: 'get_clip', input: { proofId: row.proofId } });
    }
  }
  return dedupePlan(steps);
}

function resultHits(result: AskLookupResult): Array<Record<string, unknown>> {
  const data = result.data;
  if (!data || typeof data !== 'object') return [];
  const hits = (data as { hits?: unknown }).hits;
  if (!Array.isArray(hits)) return [];
  return hits.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

/**
 * The next lookups a plan still owes: open search hits that were not read,
 * and search other jobs when the user asked and that tool has not run.
 * This does not cap an overview plan. Call it again after the new steps run.
 */
export function continueAskLookup(
  question: string,
  catalog: AskLookupCatalog,
  trace: AskLookupTraceStep[],
): Array<{ name: AskLookupToolName; input: Record<string, unknown> }> {
  const steps: Array<{ name: AskLookupToolName; input: Record<string, unknown> }> = [];
  const opened = new Set(
    trace.filter((step) => step.tool === 'get_clip').map((step) => trim(step.input.proofId)),
  );
  const pending: string[] = [];
  for (const step of trace) {
    if (step.tool !== 'search_transcripts' && step.tool !== 'search_other_jobs') continue;
    for (const hit of resultHits(step.result)) {
      const id = trim(hit.proofId);
      if (!id || opened.has(id) || pending.includes(id)) continue;
      pending.push(id);
    }
  }
  for (const proofId of pending.slice(0, 3)) {
    steps.push({ name: 'get_clip', input: { proofId } });
  }
  if (
    asksAboutOtherJobs(question) &&
    catalog.access !== 'viewer' &&
    catalog.jobId &&
    !trace.some((step) => step.tool === 'search_other_jobs')
  ) {
    const words = tokens(question).filter((word) => !OTHER_JOB_NOISE.has(word));
    const query = (words.length ? words : tokens(question)).slice(0, 6).join(' ') || trim(question).slice(0, 120);
    steps.push({ name: 'search_other_jobs', input: { query } });
  }
  return steps;
}

export function followUpAnswerable(question: string, catalog: AskLookupCatalog): boolean {
  if (SPEECH_QUESTION.test(question) && !/\bhistory\b/i.test(question)) {
    const asked = parseAskDate(question);
    const person = (catalog.people ?? []).find((row) => question.toLowerCase().includes(row.name.toLowerCase()));
    const pool = person ? clipsForPerson(catalog, person) : clipsInScope(catalog);
    const dated = asked ? pool.filter((clip) => clipMatchesAskDate(clip.workDate, asked, catalog.timeZone)) : [];
    const titled = pool.filter((clip) =>
      tokens(clip.title).some((word) => word.length > 3 && question.toLowerCase().includes(word)),
    );
    const targets = dated.length ? dated : titled.length ? titled : asked ? [] : pool;
    if (!targets.length) return false;
    return targets.some((clip) => clipHasClearSpeech(clip));
  }
  const plan = planAskLookup(question, catalog);
  if (!plan.length) return false;
  const trace: AskLookupTraceStep[] = plan.map((step) => ({
    tool: step.name,
    input: step.input,
    result: executeAskLookup(step.name, step.input, catalog),
  }));
  const prose = composeGroundedAsk(question, trace, catalog).replace(/\s+/g, ' ').trim();
  if (!prose || /^this file does not have that\b/i.test(prose)) return false;
  return true;
}

function dataOf(result: AskLookupResult): Record<string, unknown> {
  return result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : {};
}

/** Pull verbatim, already-redacted excerpts the answer is allowed to show. */
export function quotesFromTrace(trace: AskLookupTraceStep[]): AskMomentQuote[] {
  const quotes: AskMomentQuote[] = [];
  const push = (quote: AskMomentQuote) => {
    if (!quote.text || isRedactedSpeech(quote.text)) return;
    if (quotes.some((existing) => existing.sourceId === quote.sourceId && existing.text === quote.text)) return;
    quotes.push(quote);
  };
  const pool: Array<{ excerpt: string; speaker: string; atSeconds: number | null; cite: string; proofId: string }> = [];
  for (const step of trace) {
    const data = dataOf(step.result);
    const hits = Array.isArray(data.hits) ? data.hits : [];
    for (const hit of hits) {
      if (!hit || typeof hit !== 'object') continue;
      const row = hit as Record<string, unknown>;
      const cite = trim(row.cite);
      const text = trim(row.excerpt);
      if (!cite || !text || isRedactedSpeech(text)) continue;
      push({
        sourceId: cite,
        speaker: trim(row.speaker) || 'Speaker',
        text,
        atSeconds: row.atSeconds == null ? null : Number(row.atSeconds),
      });
    }
    const proofId = trim(data.proofId);
    const moments = Array.isArray(data.moments) ? data.moments : [];
    for (const moment of moments) {
      if (!moment || typeof moment !== 'object') continue;
      const row = moment as Record<string, unknown>;
      const text = trim(row.excerpt);
      const cite = trim(row.cite);
      if (!text || !cite || isRedactedSpeech(text)) continue;
      const at = row.atSeconds == null || Number.isNaN(Number(row.atSeconds)) ? null : Number(row.atSeconds);
      pool.push({ excerpt: text, speaker: trim(row.speaker) || 'Speaker', atSeconds: at, cite, proofId });
    }
  }
  if (quotes.length < 6) {
    for (const moment of selectSpeechMoments(pool, 6 - quotes.length)) {
      push({
        sourceId: moment.cite,
        speaker: moment.speaker,
        text: moment.excerpt,
        atSeconds: moment.atSeconds,
      });
    }
  }
  return quotes.slice(0, 6);
}

const FOLLOW_STOP = STOP;

function groundedQuestion(text: string, evidence: string): boolean {
  const words = tokens(text).filter((word) => !FOLLOW_STOP.has(word));
  if (!words.length) return false;
  const hay = evidence.toLowerCase();
  return words.some((word) => hay.includes(word));
}

export function suggestFollowUps(question: string, trace: AskLookupTraceStep[], catalog: AskLookupCatalog): string[] {
  const evidence = JSON.stringify(trace.map((step) => step.result.data ?? step.result.summary)).toLowerCase();
  const suggestions: string[] = [];
  const person = (catalog.people ?? []).find((row) => question.toLowerCase().includes(row.name.toLowerCase()));
  for (const clip of clipsInScope(catalog)) {
    if (!evidence.includes(clip.proofId) && !evidence.includes(clip.title.toLowerCase())) continue;
    const title = cleanMentionTitle(clip.title);
    const short = title.length > 32 && clip.workDate ? localStamp(clip.workDate, catalog.timeZone) || clip.workDate : title;
    const dated = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/.test(short);
    if (person && (person.recordedProofIds ?? []).includes(clip.proofId)) {
      suggestions.push(dated ? `What did ${person.name} say on ${short}?` : `What did ${person.name} say in ${short}?`);
    } else if (short) {
      suggestions.push(dated ? `What was said on ${short}?` : `What was said in ${short}?`);
    }
    if (suggestions.length >= 3) break;
  }
  if (evidence.includes('summary') || evidence.includes('event')) {
    suggestions.push(catalog.jobId ? 'What does the job history say happened on this file?' : 'Which jobs does that history mention?');
  }
  const unique: string[] = [];
  for (const item of suggestions) {
    if (item.toLowerCase() === question.toLowerCase()) continue;
    if (!groundedQuestion(item, `${evidence} ${clipIndex(catalog).toLowerCase()}`)) continue;
    if (!followUpAnswerable(item, catalog)) continue;
    if (unique.some((existing) => existing.toLowerCase() === item.toLowerCase())) continue;
    unique.push(item);
    if (unique.length >= 3) break;
  }
  return unique;
}

function momentBase(id: string): { base: string; at: string | null } {
  const match = id.match(/^(.*)@(\d+(?:\.\d+)?)$/);
  return match ? { base: match[1]!, at: match[2]! } : { base: id, at: null };
}

export function collectMomentSourceIds(trace: AskLookupTraceStep[]): string[] {
  const ids: string[] = [];
  const push = (id: string) => {
    const clean = trim(id);
    if (!clean) return;
    const next = momentBase(clean);
    const index = ids.findIndex((existing) => momentBase(existing).base === next.base);
    if (index === -1) {
      ids.push(clean);
      return;
    }
    const current = momentBase(ids[index]!);
    if (current.at == null && next.at != null) ids[index] = clean;
    else if (current.at != null && next.at != null && current.at !== next.at && !ids.includes(clean)) ids.push(clean);
  };
  for (const quote of quotesFromTrace(trace)) push(quote.sourceId);
  for (const step of trace) {
    const data = dataOf(step.result);
    const rows = [
      ...(Array.isArray(data.hits) ? data.hits : []),
      ...(Array.isArray(data.clips) ? data.clips : []),
    ];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      push(trim((row as { cite?: unknown }).cite));
    }
    if (typeof data.cite === 'string') push(data.cite);
    if (Array.isArray(data.moments)) {
      for (const moment of data.moments) {
        if (!moment || typeof moment !== 'object') continue;
        const cite = trim((moment as { cite?: unknown }).cite);
        const text = trim((moment as { excerpt?: unknown }).excerpt);
        if (!cite || !text || isRedactedSpeech(text)) continue;
        push(cite);
      }
    }
  }
  return ids.slice(0, 6);
}

/** True when any part of a transcript span overlaps a privacy or child-privacy range. */
export function spanIsRedacted(clip: AskLookupClip, start: number, end: number): boolean {
  const privacy = privacyRedactionsFromStored(clip.privacyRedactions);
  const child = childPrivacyRedactionsFromStored(clip.childPrivacyRedactions);
  return redactionKind(start, end, privacy, child) !== 'clear';
}

/** True when a seek second on a returned line sits inside a redaction range. Tools must not surface that speech. */
export function transcriptSecondIsRedacted(clip: AskLookupClip, atSeconds: number): boolean {
  const privacy = privacyRedactionsFromStored(clip.privacyRedactions);
  const child = childPrivacyRedactionsFromStored(clip.childPrivacyRedactions);
  return Boolean(secondsInPrivacyRange(atSeconds, privacy) || secondsInChildPrivacyRange(atSeconds, child));
}

export function groundedLookupProse(
  question: string,
  trace: AskLookupTraceStep[],
  catalog?: AskLookupCatalog | null,
): string {
  return composeGroundedAsk(
    question,
    trace,
    catalog ?? { orgId: '', jobId: null, access: 'org', clips: [] },
  );
}
