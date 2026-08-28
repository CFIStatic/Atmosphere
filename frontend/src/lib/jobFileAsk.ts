import type {
  EvidenceItem,
  JobSummary,
  ProofQuestion,
  ProofResponse,
  SharedJobRecord,
} from './api';

/** Office path for a job profile you can ask. */
export function jobFilePath(jobId: string, _extra?: { title?: string; number?: string | number | null }): string {
  return `/jobs/${encodeURIComponent(jobId)}`;
}

export interface JobFileBeat {
  id: string;
  when: string;
  kind: 'video' | 'said' | 'note';
  title: string;
  detail: string;
}

export interface JobFileTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  groundedOn?: number;
  at: string;
}

function formatWorkDate(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function looksLikeHomeowner(label: string): boolean {
  return /owner|insured|resident|customer|homeowner/i.test(label);
}

/**
 * A readable file, not a dashboard: what the clips and the record already know.
 */
export function buildJobFileDossier(input: {
  proofs: ProofResponse | null;
  messages: SharedJobRecord['messages'];
}): JobFileBeat[] {
  const beats: JobFileBeat[] = [];

  for (const message of input.messages) {
    if (!message.body.trim()) continue;
    beats.push({
      id: `msg-${message.id}`,
      when: message.created_at,
      kind: looksLikeHomeowner(message.author_label) ? 'said' : 'note',
      title: looksLikeHomeowner(message.author_label)
        ? `${message.author_label} said`
        : message.author_label,
      detail: message.body.trim(),
    });
  }

  const videos = [...(input.proofs?.videos ?? [])].sort((a, b) => {
    const byDate = b.workDate.localeCompare(a.workDate);
    if (byDate !== 0) return byDate;
    return a.phase.localeCompare(b.phase);
  });

  for (const video of videos) {
    const heard = video.heardOnMic?.trim();
    const summary = video.aiSummary?.trim();
    if (!heard && !summary) continue;
    const when = formatWorkDate(video.workDate);
    if (heard) {
      beats.push({
        id: `mic-${video.id}`,
        when: video.workDate,
        kind: 'said',
        title: `Heard on the mic · ${when}`,
        detail: heard,
      });
    }
    if (summary) {
      beats.push({
        id: `clip-${video.id}`,
        when: video.workDate,
        kind: 'video',
        title: `${video.company} · ${when}`,
        detail: summary,
      });
    }
  }

  for (const day of input.proofs?.days ?? []) {
    const summary = day.aiSummary?.trim() || day.summary?.trim();
    if (!summary) continue;
    if (beats.some((beat) => beat.detail === summary)) continue;
    beats.push({
      id: `day-${day.partyId}-${day.workDate}`,
      when: day.workDate,
      kind: 'video',
      title: `${day.company} · ${formatWorkDate(day.workDate)}`,
      detail: summary,
    });
  }

  return beats.slice(0, 8);
}

const FILE_TOPICS =
  /\b(skylights?|tarp|underlayment|decking|oak floors?|north slope|south slope|ridge vent|flashing|gutters?|shingles?|drywall|insulation|mold|kitchen|bath(?:room)?)\b/i;

function topicFrom(detail: string): string | null {
  const match = detail.match(FILE_TOPICS);
  return match?.[1]?.toLowerCase() ?? null;
}

function uniquePush(list: string[], next: string) {
  if (!list.some((item) => item.toLowerCase() === next.toLowerCase())) list.push(next);
}

/**
 * Prompts that sound like the assistant already read the file — not a menu of
 * restoration KPIs. Specific when the clips mention a thing; otherwise the
 * question you came here to ask: what did I forget?
 */
export function jobFileSuggestions(input: {
  hasMic: boolean;
  hasVideo: boolean;
  latestDate: string | null;
  beats?: JobFileBeat[];
}): string[] {
  const suggestions: string[] = [];
  const beats = input.beats ?? [];
  const said = beats.find((beat) => beat.kind === 'said');
  const clip = beats.find((beat) => beat.kind === 'video');

  if (said) {
    const topic = topicFrom(said.detail);
    uniquePush(
      suggestions,
      topic ? `What did the homeowner say about the ${topic}?` : 'What did the homeowner say?',
    );
  } else if (input.hasMic) {
    uniquePush(suggestions, 'What did the homeowner say?');
  }

  if (clip) {
    const topic = topicFrom(clip.detail);
    uniquePush(suggestions, topic ? `What happened with the ${topic}?` : 'What happened on this job?');
  } else {
    uniquePush(suggestions, input.hasVideo ? 'What happened on this job?' : 'Has anything been filmed yet?');
  }

  if (input.latestDate) {
    uniquePush(suggestions, `What did the crew do on ${formatWorkDate(input.latestDate)}?`);
  }

  uniquePush(suggestions, input.hasVideo ? 'Is anything still unfinished?' : 'Did anyone on site mention a change?');
  return suggestions.slice(0, 4);
}

/** One line so the empty file feels known, not like a dashboard you have to scan. */
export function fileKnowsCopy(input: { clipCount: number; hasMic: boolean; hasNotes: boolean }): string {
  if (input.clipCount <= 0 && !input.hasNotes && !input.hasMic) {
    return "Nothing filmed yet — I still know the job. Ask what you forgot.";
  }
  const read: string[] = [];
  if (input.clipCount === 1) read.push('1 clip');
  else if (input.clipCount > 1) read.push(`${input.clipCount} clips`);
  if (input.hasMic) read.push('what was said on the mic');
  else if (input.hasNotes) read.push('the notes on file');
  if (read.length === 0) return "I've already read this file. Ask what you forgot.";
  if (read.length === 1) return `I've already read ${read[0]}. Ask what you forgot.`;
  return `I've already read ${read[0]} and ${read[1]}. Ask what you forgot.`;
}

export function latestFilmedDate(proofs: ProofResponse | null): string | null {
  const dates = [
    ...(proofs?.videos ?? []).map((video) => video.workDate),
    ...(proofs?.days ?? []).map((day) => day.workDate),
  ].filter(Boolean);
  if (dates.length === 0) return null;
  return dates.sort()[dates.length - 1] ?? null;
}

export function hasMicOnFile(proofs: ProofResponse | null): boolean {
  return Boolean(
    proofs?.videos?.some((video) => Boolean(video.heardOnMic?.trim())) ||
      proofs?.videos?.some((video) => video.transcriptStatus === 'done'),
  );
}

export function hasVideoOnFile(proofs: ProofResponse | null): boolean {
  return Boolean((proofs?.videos?.length ?? 0) > 0 || (proofs?.days?.length ?? 0) > 0);
}

export function turnsFromQuestions(questions: ProofQuestion[]): JobFileTurn[] {
  return [...questions]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .flatMap((question) => {
      const turns: JobFileTurn[] = [
        {
          id: `${question.id}-q`,
          role: 'user',
          content: question.question,
          at: question.created_at,
        },
      ];
      if (question.answer) {
        turns.push({
          id: `${question.id}-a`,
          role: 'assistant',
          content: question.answer,
          groundedOn: question.grounded_on?.length,
          at: question.created_at,
        });
      }
      return turns;
    });
}

const MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_LONG = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Calendar tokens so "Aug 5", "2026-08-05", and "8/5/2026" all find the same day. */
export function dateSearchTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  const isoDay = value.slice(0, 10);
  const parsed = new Date(/T/.test(value) ? value : `${isoDay}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return [value.toLowerCase()];
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const short = MONTHS_SHORT[month - 1];
  const long = MONTHS_LONG[month - 1];
  const paddedDay = String(day).padStart(2, '0');
  const paddedMonth = String(month).padStart(2, '0');
  return [
    isoDay,
    `${short} ${day}`,
    `${short} ${paddedDay}`,
    `${long} ${day}`,
    `${short} ${day} ${year}`,
    `${short} ${day}, ${year}`,
    `${long} ${day} ${year}`,
    `${long} ${day}, ${year}`,
    `${month}/${day}`,
    `${month}/${day}/${year}`,
    `${paddedMonth}/${paddedDay}/${year}`,
  ];
}

/** Fields the header search can match, from the job row plus anything already on the file. */
export interface JobFileSearchFields {
  title: string;
  jobNumber: number | string | null;
  jobId?: string | null;
  claimNumber?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  scheduledStart?: string | null;
  lastEventAt?: string | null;
}

export interface JobFileSearchSource {
  job: JobFileSearchFields;
  record?: SharedJobRecord | null;
  proofs?: ProofResponse | null;
  evidence?: Array<Pick<EvidenceItem, 'id' | 'company' | 'contentHash' | 'workDate'>> | null;
  shares?: Array<{ id?: string | null; path?: string | null }> | null;
}

function pushHay(parts: string[], value: string | number | null | undefined) {
  if (value == null) return;
  const text = String(value).trim();
  if (text) parts.push(text);
}

/**
 * One searchable string for a job file: title, company, date, address, ID, hash.
 * Built from the list row plus shared job, proofs, evidence, and share links
 * when those have been loaded — never displayed, only matched.
 */
export function buildJobFileSearchHaystack(source: JobFileSearchSource): string {
  const parts: string[] = [];
  const { job, record, proofs, evidence, shares } = source;

  pushHay(parts, job.title);
  pushHay(parts, job.jobNumber);
  pushHay(parts, job.jobId);
  pushHay(parts, job.claimNumber);
  for (const date of [job.createdAt, job.updatedAt, job.scheduledStart, job.lastEventAt]) {
    parts.push(...dateSearchTokens(date));
  }

  if (record) {
    pushHay(parts, siteLine(record));
    pushHay(parts, record.job.id);
    pushHay(parts, record.job.jobNumber);
    pushHay(parts, record.job.claimNumber);
    for (const party of record.parties) {
      pushHay(parts, party.company);
      pushHay(parts, party.contactName ?? party.contact_name);
      pushHay(parts, party.email);
      pushHay(parts, party.id);
      pushHay(parts, party.accessToken);
    }
  }

  for (const video of proofs?.videos ?? []) {
    pushHay(parts, video.company);
    pushHay(parts, video.id);
    parts.push(...dateSearchTokens(video.workDate));
  }
  for (const day of proofs?.days ?? []) {
    pushHay(parts, day.company);
    parts.push(...dateSearchTokens(day.workDate));
    for (const id of day.proofIds ?? []) pushHay(parts, id);
  }

  for (const item of evidence ?? []) {
    pushHay(parts, item.company);
    pushHay(parts, item.id);
    pushHay(parts, item.contentHash);
    parts.push(...dateSearchTokens(item.workDate));
  }

  for (const share of shares ?? []) {
    pushHay(parts, share.id);
    pushHay(parts, share.path);
    const slug = share.path?.split('/').filter(Boolean).pop();
    pushHay(parts, slug);
  }

  return parts.join('\n').toLowerCase();
}

export function jobFileMatches(
  job: JobFileSearchFields | Pick<JobSummary, 'title' | 'jobNumber' | 'claimNumber'>,
  query: string,
  extraHaystack?: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${buildJobFileSearchHaystack({ job })}\n${extraHaystack ?? ''}`;
  return haystack.includes(needle);
}

export function siteLine(record: SharedJobRecord | null): string | null {
  const facts = record?.brief?.facts ?? {};
  return facts['Site address'] || facts['Address'] || facts['Property'] || null;
}
