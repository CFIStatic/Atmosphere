import type { JobSummary, ProofQuestion, ProofResponse, SharedJobRecord } from './api';

/** Office path for a job file you can ask. */
export function jobFilePath(jobId: string, extra?: { title?: string; number?: string | number | null }): string {
  const q = new URLSearchParams({ job: jobId });
  if (extra?.title) q.set('title', extra.title);
  if (extra?.number != null && extra.number !== '') q.set('number', String(extra.number));
  return `/jobs?${q.toString()}`;
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

export function jobFileMatches(job: Pick<JobSummary, 'title' | 'jobNumber' | 'claimNumber'>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    job.title.toLowerCase().includes(needle) ||
    String(job.jobNumber).includes(needle) ||
    (job.claimNumber ?? '').toLowerCase().includes(needle)
  );
}

export function siteLine(record: SharedJobRecord | null): string | null {
  const facts = record?.brief?.facts ?? {};
  return facts['Site address'] || facts['Address'] || facts['Property'] || null;
}
