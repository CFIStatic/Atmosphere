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
import { mentionSpeakerLine, sourceSlug } from './mentions.js';
import {
  formatAskClock,
  momentSourceId,
  parseAskClock,
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
  history?: AskLookupHistoryEvent[] | null;
  people?: AskLookupPerson[] | null;
};

export type AskLookupToolName =
  | 'search_transcripts'
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

/** Group word timings into short lines so the redactors see the same [m:ss] clocks as segments. */
function linesFromWords(words: AskLookupTimed[]): Array<{ start: number; text: string }> {
  const lines: Array<{ start: number; text: string }> = [];
  let current: { start: number; parts: string[] } | null = null;
  for (const word of words) {
    if (!current || word.start - current.start > 4 || current.parts.join(' ').length > 120) {
      if (current) lines.push({ start: current.start, text: current.parts.join(' ') });
      current = { start: word.start, parts: [word.text] };
    } else {
      current.parts.push(word.text);
    }
  }
  if (current) lines.push({ start: current.start, text: current.parts.join(' ') });
  return lines;
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
  const segments = asTimed(clip.segments);
  const words = asTimed(clip.words);
  let rendered: string;
  if (segments.length) {
    rendered = segments.map((seg) => `[${formatAskClock(seg.start)}] ${seg.text}`).join('\n');
  } else if (words.length) {
    rendered = linesFromWords(words)
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

function clipVisible(catalog: AskLookupCatalog, clip: AskLookupClip): boolean {
  if (clip.orgId !== catalog.orgId) return false;
  if (catalog.access === 'viewer') {
    return Boolean(catalog.jobId) && clip.jobId === catalog.jobId;
  }
  if (catalog.jobId) return clip.jobId === catalog.jobId;
  return true;
}

export function lookupPeopleFromContexts(
  people: Array<{
    userId: string;
    name: string;
    items?: Array<{ kind?: string; proofId?: string | null; captured?: boolean }> | null;
  }>,
): AskLookupPerson[] {
  return people
    .filter((person) => person.userId && person.name)
    .map((person) => {
      const items = person.items ?? [];
      return {
        userId: person.userId,
        name: person.name,
        onThisJob: true,
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
  people?: AskLookupPerson[] | null;
}): AskLookupCatalog {
  const partyById = new Map((input.parties ?? []).map((party) => [String(party.id ?? ''), party.created_by ?? null]));
  return {
    orgId: input.orgId,
    jobId: input.access === 'viewer' || input.jobId ? input.jobId : null,
    access: input.access,
    people: input.people ?? [],
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
    if (transcriptSecondIsRedacted(clip, row.start)) continue;
    const next = Math.abs(row.start - atSeconds);
    if (next < dist) {
      best = row.start;
      dist = next;
    }
  }
  return best ?? atSeconds;
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
      const speaker = speakerFor(clip, line);
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

export function getClip(catalog: AskLookupCatalog, proofId: string): AskLookupResult {
  const id = trim(proofId);
  const clip = clipsInScope(catalog).find((row) => row.proofId === id);
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
  return {
    ok: true,
    tool: 'get_clip',
    summary: `Loaded ${clip.title}.`,
    data: {
      proofId: clip.proofId,
      jobId: clip.jobId,
      jobTitle: clip.jobTitle ?? null,
      title: clip.title,
      workDate: clip.workDate ?? null,
      summary: redactAskText(trim(clip.summary), clip) || null,
      speakers: (clip.speakers ?? []).filter(Boolean),
      cite: citeFor(clip, null),
      transcript: transcript || null,
      findings: findings || null,
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
  const tagged = new Set(person.taggedProofIds ?? []);
  const explicitLists = person.recordedProofIds != null || person.taggedProofIds != null;
  const clips = clipsInScope(catalog)
    .filter((clip) => {
      if (recorded.has(clip.proofId) || tagged.has(clip.proofId)) return true;
      if (explicitLists) return false;
      return (clip.recordedByUserIds ?? []).includes(person.userId);
    })
    .map((clip) => {
      const transcript = redactClipTranscriptForAsk(clip);
      const first = redactedLines(transcript).find(
        (line) => line.text && !line.text.includes(PRIVACY_REDACTED_LABEL) && !line.text.includes(CHILD_PRIVACY_REDACTED_LABEL),
      );
      const atSeconds = preciseMoment(clip, first?.atSeconds ?? null);
      return {
        proofId: clip.proofId,
        jobId: clip.jobId,
        jobTitle: clip.jobTitle ?? null,
        title: clip.title,
        workDate: clip.workDate ?? null,
        recorded: recorded.has(clip.proofId) || (clip.recordedByUserIds ?? []).includes(person.userId),
        summary: redactAskText(trim(clip.summary), clip) || null,
        cite: citeFor(clip, atSeconds),
        atSeconds,
        speaker: first ? speakerFor(clip, first) : null,
        excerpt: first ? excerpt(first.text.replace(/^[^:]{1,40}:\s+/, '')) : null,
      };
    });
  const actions = historyInScope(catalog)
    .filter((event) => !event.actorId || event.actorId === person.userId)
    .map((event) => ({ at: event.at ?? null, summary: event.summary }));
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
    at: event.at ?? null,
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

/** Titles and ids only. Transcript bodies stay behind the tools. */
export function buildLookupUserPrompt(input: {
  question: string;
  catalog: AskLookupCatalog;
  history?: Array<{ role?: string | null; text?: string | null }> | null;
  extra?: string | null;
}): string {
  const turns = (input.history ?? [])
    .filter((turn) => trim(turn.text))
    .slice(-8)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${trim(turn.text)}`)
    .join('\n');
  const scope = input.catalog.jobId
    ? `Open job ${input.catalog.jobId}. Do not ask for other jobs.`
    : 'Org-wide office Ask. Stay inside this organization.';
  return [
    scope,
    `Clip index (no transcripts):\n${clipIndex(input.catalog)}`,
    input.extra?.trim() ? input.extra.trim() : '',
    turns ? `Recent conversation:\n${turns}` : '',
    `Question: ${input.question}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function planAskLookup(
  question: string,
  catalog: AskLookupCatalog,
): Array<{ name: AskLookupToolName; input: Record<string, unknown> }> {
  const steps: Array<{ name: AskLookupToolName; input: Record<string, unknown> }> = [];
  const q = question.toLowerCase();
  const person = (catalog.people ?? []).find((row) => q.includes(row.name.toLowerCase()));
  if (person) steps.push({ name: 'list_person_activity', input: { name: person.name } });
  const query = tokens(question)
    .filter((token) => !person || !person.name.toLowerCase().includes(token))
    .filter((token) => !ACTIVITY_VERBS.has(token))
    .slice(0, 6)
    .join(' ');
  if (query) steps.push({ name: 'search_transcripts', input: { query } });
  const titled = clipsInScope(catalog).find((clip) => {
    const words = tokens(clip.title);
    return words.some((word) => q.includes(word));
  });
  if (titled) steps.push({ name: 'get_clip', input: { proofId: titled.proofId } });
  if (/\b(done|history|file|activity|opened|created)\b/.test(q)) {
    steps.push({ name: 'read_job_history', input: {} });
  }
  const seen = new Set<string>();
  return steps.filter((step) => {
    const key = `${step.name}:${JSON.stringify(step.input)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
}

function dataOf(result: AskLookupResult): Record<string, unknown> {
  return result.data && typeof result.data === 'object' ? (result.data as Record<string, unknown>) : {};
}

/** Pull verbatim, already-redacted excerpts the answer is allowed to show. */
export function quotesFromTrace(trace: AskLookupTraceStep[]): AskMomentQuote[] {
  const quotes: AskMomentQuote[] = [];
  const push = (quote: AskMomentQuote) => {
    if (!quote.text || quotes.some((existing) => existing.sourceId === quote.sourceId && existing.text === quote.text)) return;
    quotes.push(quote);
  };
  for (const step of trace) {
    const data = dataOf(step.result);
    const hits = Array.isArray(data.hits) ? data.hits : Array.isArray(data.clips) ? data.clips : [];
    for (const hit of hits) {
      if (!hit || typeof hit !== 'object') continue;
      const row = hit as Record<string, unknown>;
      const cite = trim(row.cite);
      const text = trim(row.excerpt);
      if (!cite || !text) continue;
      push({
        sourceId: cite,
        speaker: trim(row.speaker) || 'Speaker',
        text,
        atSeconds: row.atSeconds == null ? null : Number(row.atSeconds),
      });
      if (quotes.length >= 3) return quotes;
    }
    const transcript = trim(data.transcript);
    if (transcript && quotes.length < 3) {
      const line = redactedLines(transcript).find(
        (row) => row.text && !row.text.includes(PRIVACY_REDACTED_LABEL) && !row.text.includes(CHILD_PRIVACY_REDACTED_LABEL),
      );
      const cite = trim(data.cite);
      if (line && cite) {
        const at = line.atSeconds;
        const sourceId = at == null ? cite : `${cite}@${Math.round(at * 1000) / 1000}`;
        const speakers = Array.isArray(data.speakers) ? data.speakers.map((name) => trim(name)).filter(Boolean) : [];
        push({
          sourceId,
          speaker: line.speaker || speakers[0] || 'Speaker',
          text: excerpt(line.text.replace(/^[^:]{1,40}:\s+/, '')),
          atSeconds: at,
        });
      }
    }
  }
  return quotes.slice(0, 3);
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
    const title = clip.title.replace(/[,]+$/g, '').trim();
    if (person && (person.recordedProofIds ?? []).includes(clip.proofId)) {
      suggestions.push(`What did ${person.name} say in ${title}?`);
    } else if (title) {
      suggestions.push(`What was said in ${title}?`);
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
    if (unique.some((existing) => existing.toLowerCase() === item.toLowerCase())) continue;
    unique.push(item);
    if (unique.length >= 3) break;
  }
  return unique;
}

export function collectMomentSourceIds(trace: AskLookupTraceStep[]): string[] {
  const ids: string[] = [];
  const push = (id: string) => {
    if (id && !ids.includes(id)) ids.push(id);
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
  }
  return ids.slice(0, 6);
}

/** True when a seek second on a returned line sits inside a redaction range. Tools must not surface that speech. */
export function transcriptSecondIsRedacted(clip: AskLookupClip, atSeconds: number): boolean {
  const privacy = privacyRedactionsFromStored(clip.privacyRedactions);
  const child = childPrivacyRedactionsFromStored(clip.childPrivacyRedactions);
  return Boolean(secondsInPrivacyRange(atSeconds, privacy) || secondsInChildPrivacyRange(atSeconds, child));
}

export function groundedLookupProse(question: string, trace: AskLookupTraceStep[]): string {
  const bits: string[] = [];
  for (const step of trace) {
    if (!step.result.ok) continue;
    const data = dataOf(step.result);
    if (step.tool === 'list_person_activity') {
      if (data.onThisJob === false) {
        bits.push(step.result.summary);
        continue;
      }
      const clips = Array.isArray(data.clips) ? data.clips : [];
      if (!clips.length) {
        bits.push(step.result.summary);
        continue;
      }
      const name = trim(data.name) || 'They';
      const lines = clips.map((row) => {
        const clip = row as { title?: unknown; summary?: unknown; excerpt?: unknown };
        const title = trim(clip.title) || 'a clip';
        const detail = trim(clip.summary) || trim(clip.excerpt);
        return detail ? `${title}: ${detail}` : title;
      });
      bits.push(`On file for ${name}: ${lines.join(' ')}`);
    } else if (step.tool === 'read_job_history') {
      const events = Array.isArray(data.events) ? data.events : [];
      if (!events.length) bits.push('Job history has nothing else on this question.');
      else {
        bits.push(
          `Job history: ${events
            .map((event) => trim((event as { summary?: unknown }).summary))
            .filter(Boolean)
            .join(' ')}`,
        );
      }
    } else if (step.tool === 'search_transcripts') {
      const hits = Array.isArray(data.hits) ? data.hits : [];
      if (!hits.length) bits.push('The transcripts in scope do not contain that.');
    }
  }
  if (!bits.length) {
    return 'This job file does not have that. Nothing in the clips, activity, or job history answers it.';
  }
  const asked = trim(question);
  const missing = /\b(say|said|quote|leak|attic)\b/i.test(asked)
    ? ' If a specific quote or topic is not in the lines above, it is not in the file.'
    : '';
  return `${bits.join(' ')}${missing}`.replace(/\s+/g, ' ').trim();
}
